/* comment-bank.js — the Term Questionnaire's Comment Bank engine (DECISIONS
   14, docs/questionnaire-plan.md). The teacher writes the comment; the bank
   (shared/comment-bank.js) offers wording in BC's four parts, each sentence
   filled in for the student and offered only when every slot it names has a
   value and its `when` matches. Nothing here assembles a paragraph.

   Two layers. facts() reads what FullVision has for one student this term
   (scores, assignments, Student Voice, attendance) from the data layer; it
   never reads the page or the observations (Colin, Oct 30: Generate never
   quotes an observation). Everything after it is pure: context() turns
   the facts and the teacher's picks (habits, Focus Area, I Can) into the
   slot values, and fits(), fill() and
   parts() decide what the Comment Bank column shows. draft() returns each
   sentence's provenance with the comment; verify() re-checks a draft's
   claims against the facts. */
window.CommentBank = (function () {
  'use strict';

  /* The habit scale as stored in term_rating.habits. */
  var SCALE = ['Rarely', 'Sometimes', 'Usually', 'Consistently', 'Not Seen'];
  var CONSISTENTLY = 4;
  var NOT_SEEN = 5;

  /* The six habits: the name and hint on the scale, and how the habits
     sentence says it: `build` as the habit to build ("completing work on
     time"), `does` and `do` as a strength ("comes to class ready", "they
     come to class ready"). {his} is filled with the student's pronoun.
     Other kinds of class say Completes Work their own way (habitWords). */
  var HABITS = [
    {
      key: 'completes',
      name: 'Completes Work',
      hint: 'Hands in assignments, complete and on time',
      build: 'completing work on time',
      does: 'completes work on time',
      do: 'complete work on time',
    },
    {
      key: 'ready',
      name: 'Comes Ready and Uses Class Time',
      hint: 'Brings materials, starts tasks, stays on task',
      build: 'using class time well',
      does: 'comes to class ready',
      do: 'come to class ready',
    },
    {
      key: 'others',
      name: 'Works With Others',
      hint: 'Listens, shares the work, helps classmates',
      build: 'working well with others',
      does: 'works well with others',
      do: 'work well with others',
    },
    {
      key: 'part',
      name: 'Takes Part',
      hint: 'Asks questions, adds to discussions',
      build: 'taking part in class',
      does: 'takes part',
      do: 'take part',
    },
    {
      key: 'feedback',
      name: 'Uses Feedback',
      hint: 'Revises work, keeps going, asks for help',
      build: 'using feedback',
      does: 'uses feedback',
      do: 'use feedback',
    },
    {
      key: 'devices',
      name: 'Uses Devices Well',
      hint: 'Phone away when asked, devices for learning, not a distraction',
      build: 'using devices well',
      does: 'uses devices well',
      do: 'use devices well',
    },
  ];

  /* Completes Work in PE is taking part; in Arts it is completing the work,
     never handing it in (no Arts sentence says "handing in complete
     work"). Every habit phrase a sentence uses comes through habitWords. */
  var HABIT_FAMILY_WORDS = {
    pe: {
      completes: {
        build: 'taking a full part in every activity',
        does: 'takes a full part in every activity',
        do: 'take a full part in every activity',
      },
    },
    arts: {
      completes: { build: 'completing {his} work', does: 'completes {his} work', do: 'complete {his} work' },
    },
  };
  /* A habit's phrase in one form (build, does, do) for a kind of class, with
     {his} filled from the pronouns p. */
  function habitWords(key, form, family, p) {
    var h = HABITS.find(function (x) {
      return x.key === key;
    });
    var fam = (HABIT_FAMILY_WORDS[family] || {})[key];
    var t = (fam && fam[form]) || (h && h[form]) || '';
    return t.replace(/\{his\}/g, (p && p.poss) || 'their');
  }

  /* The kind of class, for the bank's subject wording: one of adst, arts,
     career, ela, languages, math, pe, science, socials, or '' when
     unknown. From the learning map's subject (its BC subject area, or its
     course tag), else the class's name. Languages (lane H, Nov 1) are the
     second-language courses: French, Spanish, Punjabi, Japanese, Mandarin,
     Korean, German, Italian, ASL and the like. */
  var FAMILIES = {
    'Applied Design, Skills and Technologies': 'adst',
    'Arts Education': 'arts',
    'Career Education': 'career',
    'English Language Arts': 'ela',
    Languages: 'languages',
    'Second Languages': 'languages',
    Mathematics: 'math',
    'Physical and Health Education': 'pe',
    Science: 'science',
    'Social Studies': 'socials',
  };
  var TAG_FAMILIES = [
    [/^(PHE|AL|FC|ODED)\d/, 'pe'],
    [/^(SCI|ANAT|BIO|CHEM|EARTH|ENVSCI|GEO|LS\d+SCI|PHYS|SFC)/, 'science'],
    [/^(MATH|APPM|CALC|CS\d|FOM|FPC|HOM|PC\d|STAT|WPM)/, 'math'],
    // Second languages; FRAL and FRSL (Français langue première / seconde,
    // immersion) are language arts for fluent students and fall to ela.
    [/^(FR|SPAN|SPN|PUNJ|PUN|JAPN|JPN|MAND|MAN|KOR|KORN|GERM|GER|ITAL|ITL|ASL|HIND|ARAB)\d/, 'languages'],
    [/^(ELA|COMP\d|CW|EFP|ES12|LS\d|NM|NMED|SL|SPKN|HUM)/, 'ela'],
    [/^(SS|ASIA|BCFP|CC12|CIS12|ECON|ESS|GEN|HGEO|HIST|INDS|LAW|PGEO|PHIL|PHYG|POL|REL|SJ|URB)/, 'socials'],
    [/^(CAREE|CLC|CLE)/, 'career'],
    [
      /^(ARTS|ARTSTUDIO|CHOR|CMUSIC|COMP_PROD|CP12|DANCE|DCHORE|DCOMP|DCOND|DFOUND|DRAMA|DSD|DTEP|FTVT|GARTS|INS|MEDIA|MTHEATRE|MUSIC|PHOTO|SA2D|SA3D|THCO|THPROD|VA)/,
      'arts',
    ],
  ];
  var NAME_FAMILIES = [
    [/\b(pe|p\.e\.|phys(ical)?\s*(and health )?ed|fitness|outdoor|active living|health)\b/i, 'pe'],
    [/\b(science|biology|chemistry|physics|earth|geology|environmental)\b/i, 'science'],
    [/\b(math|calculus|pre-?calc|statistics|foundations|workplace math)/i, 'math'],
    [/\b(english|ela|literary|composition|creative writing|spoken language|new media|humanities)\b/i, 'ela'],
    [
      /\b(social|socials|history|geography|law|philosophy|economics|political|psychology|genocide|justice)\b/i,
      'socials',
    ],
    [/\b(career|planning|clc|cle)\b/i, 'career'],
    // After socials and ela, so "Social Studies 9 French Immersion" stays
    // socials; "immersion" alone names no kind of class.
    [
      /\b(french|français|francais|spanish|punjabi|japanese|mandarin|korean|german|italian|hindi|arabic|asl|sign language)\b/i,
      'languages',
    ],
    [/\b(drama|theatre|theater|music|band|choir|choral|dance|art|arts|photo|film|media arts|visual)\b/i, 'arts'],
    [
      /\b(foods|textiles|wood|metal|tech|computer|coding|design|engineering|business|marketing|automotive|electronics|drafting|culinary|robotics|adst|shop)\b/i,
      'adst',
    ],
  ];
  function familyOf(cid) {
    var map = typeof getLearningMap === 'function' ? getLearningMap(cid) : null;
    var sub = map && map.subjects && map.subjects[0];
    if (sub && sub.family && FAMILIES[sub.family]) return FAMILIES[sub.family];
    var tag = sub && String(sub.id || '');
    for (var i = 0; tag && i < TAG_FAMILIES.length; i++) if (TAG_FAMILIES[i][0].test(tag)) return TAG_FAMILIES[i][1];
    var name = (typeof COURSES !== 'undefined' && COURSES[cid] && COURSES[cid].name) || '';
    for (var k = 0; name && k < NAME_FAMILIES.length; k++)
      if (NAME_FAMILIES[k][0].test(name)) return NAME_FAMILIES[k][1];
    return '';
  }

  /* ── Competencies as skills (plan PR 8) ────────────────────────────── */

  /* The names data/bc-curriculum-derived.json gives BC competencies
     (stage 2 of the bank rebuild) whose skill the row's own pattern
     misses. Each is matched whole, so no other label moves to a
     different skill. */
  function withNames(pattern, names) {
    var whole = names.map(function (n) {
      return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    return new RegExp(pattern.source + '|^(?:' + whole.join('|') + ')$', pattern.flags);
  }

  /* The competency-to-skill table, per kind of class: a competency's label
     (as the report names it) matched in order, first match wins, to one
     skill in plain words. `skill` finishes "Next, {he} can …", so it starts
     with a verb and names no competency. A label nothing matches has no
     skill, and the comment never falls back to the bare label. */
  var SKILLS = {
    socials: [
      {
        key: 'ethical',
        name: 'Ethical Judgment',
        match: /ethical|judg/i,
        skill: 'judge a past event fairly, by what people knew then',
      },
      {
        key: 'significance',
        name: 'Significance',
        match: /signific/i,
        skill: 'explain why an event mattered and who it affected',
      },
      {
        key: 'perspective',
        name: 'Perspective',
        match: /perspective/i,
        skill: 'judge a source by who created it and why',
      },
      {
        key: 'cause',
        name: 'Cause and Consequence',
        match: withNames(/cause|consequence|effect/i, [
          'Factor Interactions',
          'Impact on People',
          'Theory Impacts',
          'Theory Origins',
        ]),
        skill: 'explain the causes and results of an event',
      },
      {
        key: 'continuity',
        name: 'Continuity and Change',
        match: withNames(/continuity|change|patterns and trends/i, ['Patterns & Trends']),
        skill: 'explain what changed over time and what stayed the same',
      },
      {
        key: 'evidence',
        name: 'Evidence',
        match: /evidence|source|cite|accounts/i,
        skill: 'support each claim with evidence from a source',
      },
      {
        key: 'inquiry',
        name: 'Inquiry',
        match: /inquiry/i,
        skill: 'ask a clear question and gather sources to answer it',
      },
    ],
    science: [
      {
        key: 'evaluating',
        name: 'Evaluating',
        match: withNames(/evaluat/i, [
          'Assumptions & Bias',
          'Method Improvement',
          'Method Reflection',
          'Sources of Error',
        ]),
        skill: 'judge how reliable results are and how to improve the method',
      },
      {
        key: 'questioning',
        name: 'Questioning and Predicting',
        match: withNames(/question|predict|curiosity/i, ['Hypotheses', 'Observation']),
        skill: 'ask a testable question and make a prediction',
      },
      {
        key: 'planning',
        name: 'Planning and Conducting',
        match: withNames(/plan|conduct|investigat/i, ['Accuracy & Precision', 'Variable Control']),
        skill: 'plan a fair test and record measurements carefully',
      },
      {
        key: 'processing',
        name: 'Processing and Analyzing',
        match: withNames(/process|analy[sz]|data|graph|pattern/i, ['Cause & Effect', 'Drawing Conclusions']),
        skill: 'describe the pattern in the data and what it shows',
      },
      {
        key: 'applying',
        name: 'Applying and Innovating',
        match: withNames(/appl[yi]|innovat/i, [
          'Finding Solutions',
          'Idea Generation',
          'Solution Strategies',
          'Transfer of Learning',
        ]),
        skill: 'apply a science idea to a problem in daily life',
      },
      {
        key: 'communicating',
        name: 'Communicating',
        match: withNames(/communicat/i, ['Scientific Argument', 'Sharing Findings']),
        skill: 'explain results clearly, using science words and a labelled graph',
      },
    ],
    math: [
      {
        key: 'communicating',
        name: 'Communicating and Representing',
        match: /communicat|represent/i,
        skill: 'show each step of a solution so someone else can follow it',
      },
      {
        key: 'connecting',
        name: 'Connecting and Reflecting',
        match: withNames(/connect|reflect/i, ['Supporting Choices']),
        skill: 'connect a math idea to a real situation',
      },
      {
        key: 'reasoning',
        name: 'Reasoning and Modelling',
        match: withNames(/reason|model|logic|pattern|thinking/i, ['Justification']),
        skill: 'explain why a method works, not just the steps',
      },
      {
        key: 'solving',
        name: 'Understanding and Solving',
        match: /understand|solv|strateg|problem/i,
        skill: 'choose a strategy for a new problem and check the answer',
      },
      // The sub-skills a grade 8–12 math teacher names (lane H, Nov 1),
      // after the four strands: a label main already routed keeps its
      // skill; these catch only what fell through.
      {
        key: 'estimating',
        name: 'Estimating',
        match: /estimat|mental math|reasonabl|number sense/i,
        skill: 'estimate the answer first and use the estimate to check the result',
      },
      {
        key: 'patterns',
        name: 'Sequences and Rules',
        match: /sequence|puzzle|conjecture|generali[sz]|\brules?\b/i,
        skill: 'find the rule in a pattern and predict the next case',
      },
      {
        key: 'graphs',
        name: 'Graphs and Tables',
        match: /\bgraph|table|diagram|chart|plot/i,
        skill: 'show numbers in a graph or table and explain its shape',
      },
      {
        key: 'notation',
        name: 'Notation and Units',
        match: /notation|symbol|equation|formula|algebra|expression|\bunits?\b/i,
        skill: 'write each line of math with the right symbols, signs and units',
      },
      {
        key: 'wordProblems',
        name: 'Real-World Applications',
        match: /word problem|real.?world|real.?life|applied|applications? (to|of|in)|everyday|situation/i,
        skill: 'write a word problem as an equation and explain the answer',
      },
      {
        key: 'procedures',
        name: 'Procedures',
        match: /procedur|fluenc|accura|calculat|operation|arithmetic|computation|basic skill/i,
        skill: 'follow each step of a procedure in order and check the arithmetic',
      },
    ],
    ela: [
      {
        key: 'conventions',
        name: 'Conventions',
        match: /convention|spelling|grammar/i,
        skill: 'check the spelling and punctuation in a final copy',
      },
      {
        key: 'revising',
        name: 'Revising',
        match: /revis|refin/i,
        skill: 'revise a draft so each idea is clear and in order',
      },
      {
        key: 'speaking',
        name: 'Exchanging Ideas',
        match: withNames(/exchang|speak|oral|discuss|listen/i, ['Media Collaboration']),
        skill: 'share an idea in discussion and respond to what others say',
      },
      {
        key: 'information',
        name: 'Accessing Information',
        match: withNames(/access|information|research/i, ['Source Citation', 'Rights & Protocols']),
        skill: 'find information in a reliable source and name where it was found',
      },
      {
        key: 'reading',
        name: 'Comprehend and Connect',
        match: withNames(/comprehen|read|respond|text|literary|literature|analy[sz]/i, [
          'Influence of Place',
          'Story & Tradition',
          'Language & Worldview',
          'Techniques & Devices',
          'New Media Techniques',
          'Media Techniques',
        ]),
        skill: 'support an idea about a text with details from it',
      },
      {
        key: 'thinking',
        name: 'Thinking Critically',
        match: withNames(/critical|thinking/i, ['Idea Exploration', 'Opinion & Evidence', 'Personal Response']),
        skill: 'explain a view of a text and give reasons for it',
      },
      {
        key: 'writing',
        name: 'Create and Communicate',
        match: withNames(/writ|compos|creat|communicat/i, ['Multimedia Design']),
        skill: 'plan a piece of writing before drafting it',
      },
    ],
    arts: [
      {
        key: 'reflecting',
        name: 'Reason and Reflect',
        match: withNames(/reason|reflect|critique|critical|analy[sz]|evaluat|judg/i, [
          'Artist Motivations',
          'Dance Interpretation',
          'Describing Art',
          'Interpretation',
          'Interpreting Art',
          'Responding to Art',
          'Selection Design',
          'Structure & Form',
          'Material Choices 2',
          'Dance Vocabulary',
          'Linking Experiences',
          'Props & Technology',
          'Musical Vocabulary',
        ]),
        skill: 'explain the choices in a piece and what they add',
      },
      {
        key: 'creating',
        name: 'Explore and Create',
        match: withNames(/explor|creat|compos|experiment|express/i, [
          'Idea Generation',
          'Improvisation',
          'Combining Genres',
          'Musical Ideas',
          'Choreographic Device',
          'Dialogue & Action',
          'Words & Action',
          'Voice & Style',
          'Script Innovation',
          'Design Innovation',
          'Movement Interplay',
          'Resolving Challenges',
          'Orchestration',
          'Production Design',
        ]),
        skill: 'try more than one idea before choosing one to develop',
      },
      {
        key: 'communicating',
        name: 'Communicate and Document',
        match: withNames(/communicat|document|present|perform|shar|exhibit/i, [
          'Ideas & Emotions',
          'Ideas & Perspectives',
          'Thoughts & Emotions',
          'Meaning & Emotion',
          'Cultural Identity',
          'Personal Voice',
          'Responding to Issues',
          'Global Issues',
          'Choreographic Intent',
          'Specialized Language',
          'Personal Insights',
          'Audience & Venue',
          'Personal Narrative',
          'Cross-Cultural Work',
        ]),
        skill: 'present work and explain the ideas behind it',
      },
      {
        key: 'connecting',
        name: 'Connect and Expand',
        match: withNames(/connect|expand|context|tradition/i, [
          'Ways of Knowing',
          'Culture & Society',
          'Cultural Influences',
          'Music & Change',
          'Music & Issues',
          'Impact of Drama',
          'Land & Resources',
          'Place & Time',
          'Aesthetic Experience',
          'Dramatic Experience',
          'Canadian Film & TV',
          'Global Film & TV',
          'Artist Contributions',
          'Dance Innovators',
          'Meaningful Works',
        ]),
        skill: 'connect a piece to the time and place that made it',
      },
      {
        key: 'technique',
        name: 'Technique',
        match: withNames(/techni|skill|rehears|practi/i, [
          'Core & Turnout',
          'Movement Awareness',
          'Somatic Approaches',
          'Musicianship',
          'Dance Forms',
          'Specialization',
          'Gestural Vocabulary',
          'Body as Instrument',
        ]),
        skill: 'practise one hard technique until it is steady',
      },
      // Dance, drama, music, visual arts and photography sub-skills (lane
      // H, Nov 1), after the strands, each pattern narrow enough that a
      // Dance, Photo or Film course is not swept into one skill.
      {
        key: 'planning',
        name: 'Planning a Piece',
        match: withNames(
          /plan(ning)? (a|the|each) (piece|work|composition|project)|sketch\b|thumbnail|storyboard|outline|brainstorm/i,
          ['Production Planning', 'Production'],
        ),
        skill: 'plan a piece with a sketch or outline before the final version',
      },
      {
        key: 'revising',
        name: 'Using Feedback',
        match: /revis|feedback|refin|improve\b|edit(ing)? (a|the) draft/i,
        skill: 'use feedback on a draft to change one part of the piece',
      },
      {
        key: 'elements',
        name: 'Elements and Principles',
        match: withNames(
          /element|principle|colou?r|\bline\b|shape|texture|rhythm|dynamics|\btempo\b|pitch|harmony|melody/i,
          ['Genre Qualities'],
        ),
        skill: 'name the elements used in a piece and the effect of each',
      },
      {
        key: 'performing',
        name: 'Ensemble and Stage',
        match: withNames(/\bstage|ensemble(?! heritage)|\bchoir|\bband\b|\bacting|repertoire|instrument/i, [
          'Movement Phrases',
          'Motifs & Phrases',
          'Choreographic Works',
        ]),
        skill: 'rehearse a part until the whole piece runs without stopping',
      },
      {
        key: 'notation',
        name: 'Reading Notation',
        match: withNames(/notation|sight-?read|read(ing)? music|music theory|\bscore\b|\bscales?\b(?= and| on)/i, [
          'Musical Symbols',
        ]),
        skill: 'read written music and play or clap it in time',
      },
      {
        key: 'camera',
        name: 'Camera and Light',
        match: /camera|lens|exposure|shutter|framing|\bfocus|\bshot\b/i,
        skill: 'control the light and framing before each photo or shot',
      },
      {
        key: 'documenting',
        name: 'Process Journal',
        match: /portfolio|artist statement|journal|sketchbook|process record/i,
        skill: 'record each stage of a piece and note what changed',
      },
    ],
    pe: [
      {
        key: 'safety',
        name: 'Safety',
        match: withNames(/safe|risk|injur/i, ['Emergency Response', 'Condition Monitoring']),
        skill: 'explain how to stay safe in an activity',
      },
      {
        key: 'wellbeing',
        name: 'Well-being',
        match: withNames(/well-?being|mental|health|wellness|nutrition/i, ['Lifestyle Analysis']),
        skill: 'describe one healthy choice and how it helps the body or mind',
      },
      {
        key: 'leading',
        name: 'Leadership',
        match: withNames(/lead|coach|social|community/i, ['Collaboration', 'Communication']),
        skill: 'encourage teammates and include others in an activity',
      },
      {
        key: 'fitness',
        name: 'Fitness',
        match: withNames(/fitness|active|activity|training|strength|cardio/i, ['Goal Reflection']),
        skill: 'set a fitness goal and track progress toward it',
      },
      {
        key: 'movement',
        name: 'Movement Skills',
        match: /skill|literacy|movement|develop|demonstrat/i,
        skill: 'practise a movement skill and use it in a game or activity',
      },
      // Physical literacy, healthy living, social and community health and
      // mental well-being sub-skills (lane H, Nov 1), after the five broad
      // ones. "strateg" alone is in every PHE competency's wording, so
      // only a game's strategy counts.
      {
        key: 'outdoor',
        name: 'Outdoor Education',
        match: /outdoor|land-based|wilderness|expedition|hik(e|ing)|camp(ing)?\b|navigat/i,
        skill: 'plan the route, the weather and the gear before an outdoor activity',
      },
      {
        key: 'strategy',
        name: 'Game Strategy',
        match: /game strateg|tactic|game sense|offen[cs]|defen[cs]|game plan/i,
        skill: 'read the play and move to open space before the pass',
      },
      {
        key: 'nutrition',
        name: 'Eating and Hydration',
        match: /\beating|\bdiet|hydrat|sleep|food choice/i,
        skill: 'plan the food and water an active day needs',
      },
      {
        key: 'relationships',
        name: 'Relationships and Consent',
        match: /relationship|consent|respect|bully|conflict|friend/i,
        skill: 'describe what a healthy relationship looks like and where to find help',
      },
      {
        key: 'substances',
        name: 'Substance Use',
        match: /substance|\bdrug|alcohol|vap(e|ing)|tobacco|addict|cannabis/i,
        skill: 'explain a substance’s risks and practise a way to say no',
      },
      {
        key: 'pacing',
        name: 'Endurance and Pacing',
        match: /endur|pacing|\bpace\b|aerobic|stamina|\brun(ning)?\b/i,
        skill: 'hold an even pace for the whole run',
      },
      {
        key: 'stress',
        name: 'Managing Stress',
        match: /stress|anxiety|coping|emotion|resilien|mindful|self-?regulat/i,
        skill: 'use one way to lower stress before a test or game',
      },
    ],
    adst: [
      {
        key: 'testing',
        name: 'Testing',
        match: withNames(/test|prototyp|evaluat|iterat|feedback|revision/i, [
          'Critique Application',
          'Critique Editing',
          'Results Application',
          'Idea Decisions',
          'Procedure Changes',
        ]),
        skill: 'test a prototype and use the results to improve it',
      },
      {
        key: 'sharing',
        name: 'Sharing',
        match: withNames(/shar|present|document|portfolio|communicat/i, [
          'Process Reflection',
          'New Possibilities',
          'Concept Extensions',
          'Outcome Format',
        ]),
        skill: 'explain how a project was made and what could be improved',
      },
      {
        key: 'tools',
        name: 'Tools and Technologies',
        match: /tool|technolog|software|cad\b|digital|program|code|equipment/i,
        skill: 'choose the right tool or program for each project step',
      },
      {
        key: 'designing',
        name: 'Designing',
        match: /plan|design|ideat|defin|context/i,
        skill: 'plan a design with a sketch and measurements before making it',
      },
      {
        key: 'making',
        name: 'Making',
        match: /mak|construct|build|fabricat|finish|techniqu|weld|cook|prep/i,
        skill: 'use tools safely and carefully to finish a project',
      },
      // Every ADST course family (lane H, Nov 1): foods, textiles, woodwork
      // and metalwork, drafting, coding, business, media, plus safety,
      // materials and teamwork on a build. After the five broad ones, so a
      // label main already routed keeps its skill.
      {
        key: 'safety',
        name: 'Safety',
        match: /safe|hazard|sanitation|hygiene|whmis|\bppe\b/i,
        skill: 'follow every safety step before and while using a tool or machine',
      },
      {
        key: 'foodPrep',
        name: 'Recipes and Kitchen Skills',
        match: withNames(/recipe|knife|kitchen|meal prep|culinary|bak(e|ing)\b|food prep|mise en place|plating/i, [
          'Food Creation',
        ]),
        skill: 'follow a recipe in order, measuring each ingredient and timing each step',
      },
      {
        key: 'sewing',
        name: 'Sewing and Textiles',
        match: /\bsew|knit|textile|garment|stitch|fabric\b|pattern|fashion|cloth/i,
        skill: 'read a pattern and sew each seam in the order it gives',
      },
      {
        key: 'fabricating',
        name: 'Cutting and Joining',
        match:
          /woodwork|metalwork|joinery|\bjoin|cutting(?!-edge)|machin(e|ing)\b(?! learning)|lathe|\bmill|\bsaw\b|drill|cabinet|furniture|\bforming/i,
        skill: 'measure and cut each piece to the plan before joining it',
      },
      {
        key: 'drafting',
        name: 'Drafting',
        match: /draft|drawing|sketch|blueprint|orthographic|isometric|dimension|technical draw/i,
        skill: 'draw a plan to scale with every measurement labelled',
      },
      {
        key: 'coding',
        name: 'Coding',
        match: /\bcod(e|ing)\b|programm|algorithm|debug|script|robot|microcontroller|javascript|html|css/i,
        skill: 'test a program in small parts and fix each error',
      },
      {
        key: 'media',
        name: 'Media and Graphics',
        match: /(?<!social )media|video|animat|graphic|typograph|page layout|\bweb|multimedia|podcast|audio|brand/i,
        skill: 'plan and edit a media piece with one audience in mind',
      },
      {
        key: 'business',
        name: 'Business',
        match:
          /business|market|entrepreneur|account|financ(?!.*(family|consumer))|budget|customer|sales|e-?commerce|enterprise|\bcost/i,
        skill: 'explain who a product is for and what its price covers',
      },
      {
        key: 'materials',
        name: 'Material Selection',
        match:
          /material (science|selection|propert)|select(ing)? [\w ]*materials|fibre|fiber|\bstock\b|ingredient|lumber/i,
        skill: 'choose the right material for a job and say why',
      },
      {
        key: 'collaborating',
        name: 'Teamwork',
        match: /collaborat|\bteam|\bgroup|cooperat|partner/i,
        skill: 'share the work in a group build and follow the agreed plan',
      },
    ],
    career: [
      {
        key: 'self',
        name: 'Self-Awareness',
        match: withNames(/self|awareness|worldview|identity|personal/i, [
          'Using Strengths',
          'Sharing Strengths',
          'Skills Assessment',
          'Transferable Skills',
        ]),
        skill: 'name personal strengths and connect them to a future goal',
      },
      {
        key: 'connecting',
        name: 'Connections',
        match: withNames(/connect|interact|mentor|network|experience|workplace|reflect/i, [
          'Problem Solving',
          'Learning Highlights',
        ]),
        skill: 'reflect on a work or volunteer experience and what it taught',
      },
      {
        key: 'exploring',
        name: 'Exploring Careers',
        match: withNames(/explor|career|possibilit/i, ['Work Placements']),
        skill: 'research one career path and what it requires',
      },
      {
        key: 'planning',
        name: 'Planning',
        match: withNames(/plan|life/i, ['Preferred Futures', 'Skill Development']),
        skill: 'set a goal for after school and the steps toward it',
      },
      // Career Life Education sub-skills (lane H, Nov 1), after the four
      // broad ones.
      {
        key: 'influences',
        name: 'Influences on Decisions',
        match: /influenc|examin|decision|\bvalues?\b|role model|\bmedia/i,
        skill: 'explain how family, friends and media shape a choice about the future',
      },
      {
        key: 'interview',
        name: 'Résumés and Interviews',
        match: /r[ée]sum|interview|cover letter|job search|job application|hiring|employab|portfolio/i,
        skill: 'show in a résumé or interview how past experience fits a job',
      },
      {
        key: 'budgeting',
        name: 'Budgeting',
        match: /budget|financ|money|\bcost|income|saving|spending/i,
        skill: 'make a simple budget and explain each spending choice',
      },
      {
        key: 'postSecondary',
        name: 'Post-Secondary Options',
        match: /post-?secondary|graduat|transition|pathway|apprentice|college|universit|training|scholarship/i,
        skill: 'compare two options for after graduation by cost, time and entry requirements',
      },
    ],
    // Second languages (lane H, Nov 1): French, Spanish, Punjabi, Japanese
    // and the rest share one table, ASL too: the skills say "the
    // language", never which one, hold for a signed language and for one
    // without verb endings, articles or a shared script, and assume
    // nothing about which languages the family speaks. Listening sits
    // before reading so "Listening Comprehension" is listening;
    // communicating before understanding so "Thinking and Communicating"
    // is communicating.
    languages: [
      {
        key: 'listening',
        name: 'Listening',
        match: /listen|audio|speech|\bsign(ing|ed)\b|viewing|comprehen/i,
        skill: 'find the main idea in a short spoken or signed message',
      },
      {
        key: 'speaking',
        name: 'Speaking',
        match: /speak|\boral|conversation|pronunc|dialogue|presentation|presenting/i,
        skill: 'ask and answer simple questions in the language in a short conversation',
      },
      {
        key: 'reading',
        name: 'Reading',
        match: /\bread|written text|\bprint/i,
        skill: 'say what a short text in the language is about',
      },
      {
        key: 'writing',
        name: 'Writing',
        match: /writ|compos|paragraph|sentence/i,
        skill: 'write a short paragraph in the language in the right word order',
      },
      {
        key: 'vocabulary',
        name: 'Vocabulary',
        match: /vocab|\bwords?\b|lexic/i,
        skill: 'use the new words from each unit in full sentences',
      },
      {
        key: 'grammar',
        name: 'Grammar',
        match: /grammar|\bverb|tense|structure|accura|conjugat|agreement/i,
        skill: 'use the verb form or marker for who is acting and when',
      },
      {
        key: 'culture',
        name: 'Culture',
        match: /cultur|communit|tradition|awareness|identity|perspective|\bsocial/i,
        skill: 'describe a custom of a community that uses the language',
      },
      {
        key: 'communicating',
        name: 'Communicating',
        match: /communicat|interact|exchange|express|respond|engag/i,
        skill: 'use another word or a gesture to be understood in the language',
      },
      {
        key: 'understanding',
        name: 'Understanding',
        match: /understand|meaning|interpret|gist|negotiat|think/i,
        skill: 'use the words around an unknown word to guess its meaning',
      },
    ],
  };

  /* BC bank names (data/bc-curriculum-derived.json) that a row's keyword
     catches but whose competency that row's skill misdescribes, as an
     independent review found: "Relationship Skills" is not a movement
     skill. A wrong skill in a report is worse than none, so these route
     to no skill. Labels in use today are not listed, so none of them
     moves. */
  var NO_SKILL = {
    adst: [
      'Potential Customers',
      'Design Creation',
      'Technique Selection',
      'Decision Evaluation',
      'Feedback Revisions',
      'Feedback Sources',
      'Goal Identification',
      'Idea Evaluation',
      'Iteration Records',
      'Material Testing',
      'Plan Evaluation',
      'Prototype Building',
      'Prototype Form',
      'Prototype Procedures',
      'Scenario Feedback',
      'Integrated Software',
      'Financial Status',
      'Financial Strength',
      'Idea Collaboration',
      'User Collaboration',
      'Consumer Context',
      'Context Research',
      'Design Goals',
      'Design Issues',
      'Design Reflection',
      'Design Research',
      'Plan Execution',
      'Users & Context',
      'Wishes & Context',
      'Draft Approach',
      'Culinary Decisions',
      'Kitchen Capabilities',
      'Kitchen Contribution',
      'Recipe Selection',
      'Interpersonal Safety',
      'Impact Evaluation',
      'Material Evaluation',
      'Skill Evaluation',
      'Strategy Evaluation',
      'Conditions & Tools',
      'Culture & Technology',
      'Role of Technology',
      'Technology & Society',
      'Technology Impacts',
      'Group or Solo Work',
    ],
    arts: [
      'Anticipated Response',
      'Audience & Message',
      'Audience Impact',
      'Dramatic Conventions',
      'Intended Audience',
      'Intended Message',
      'Personal Style',
      'Purpose & Audience',
      'Symbolism & Imagery',
      'Symbolism & Metaphor',
      'Writing & Directing',
      'Contextual Design',
      'Music Trends',
      'Story & Narrative',
      'Story & Values',
      'Styles & Genres',
      'Creative Risk-Taking',
      'Musical Risk-Taking',
      'Artistic Choices',
      'Element Manipulation',
      'Materials & Tools',
      'Mood & Meaning',
      'Moving-Image Choices',
      'Dance, Drama & Music',
      'Ensemble Role',
      'Material Choices',
      'Adapting Technique',
      'Dance Performance',
      'Performance Skills',
      'Performance Goals',
      'Eating & Performance',
      'Performers & Genres',
      'Refining Performance',
      'Community Connection',
      'Company Connection',
      'Global Connection',
      'Making Connections',
      'Mind-Body Connection',
      'Personal Connections',
      'Wider Connections',
      'Composer Intent',
      'Composing for Effect',
      'Composition',
      'Composition Design',
      'Composition Skills',
      'Creative Choices',
      'Expressive Technique',
      'Movement Principles',
      'Diverse Repertoire',
      'Instrument Care',
      'Feedback Reflection',
      'Process Reflection',
      'Production Analysis',
      'Reciprocal Critique',
      'Rehearsal Reflection',
      'Self-Reflection',
      'Using Critique',
      'Design & Refinement',
      'Phrase Refinement',
      'Adapting Skills',
      'Leadership Skills',
      'Meaning & Technique',
      'Responsible Practice',
      'Safe Practice',
      'Self-Care Practice',
      'Technical Vocabulary',
    ],
    career: [
      'Purpose & Community',
      'Employment Networks',
      'Mentorship',
      'Networking',
      'Networks & Mentors',
      'Safe Interactions',
      'Workplace Ethics',
      'Workplace Safety',
      'Career Challenges',
      'Career Influences',
      'Career-Life Choices',
      'Career-Life Plans',
      'Decision-Making',
      'Public Identity',
      'Worldview Influence',
    ],
    ela: [
      'Personal Reading',
      'Oral Traditions',
      'Text Authenticity',
      'Text Reliability',
      'Listener Engagement',
      'Oral Formats',
      'Form Selection',
      'Media Selection',
    ],
    math: [
      'Representation',
      'Puzzles & Games',
      'Concept Development',
      'Persistent Solving',
      'Reflection',
      'Mental Math',
      'Historical Symbols',
      'Consequences of Math',
      'Modelling in Context',
      'Place-Based Thinking',
      'Spatial Reasoning',
      'Problem Exploration',
      'Strategy Critique',
    ],
    pe: [
      'Recreation',
      'Eating Strategies',
      'Outdoor Preparation',
      'Bullying Responses',
      'Safety Strategies',
      'Community Health',
      'Managing Change',
      'Activity Preferences',
      'Activity Strategies',
      'Fitness Activity',
      'Fitness Etiquette',
      'Fitness Myths',
      'Lifelong Activity',
      'Muscle Training',
      'Training Styles',
      'Social Influences',
      'Communication Skills',
      'Relationship Skills',
      'Outdoor Activities',
      'Substance Use Causes',
      'Health Messages',
    ],
    science: ['Data Collection', 'Data Recording', 'Source Validity'],
    socials: ['Ethics in Sources', 'Geographic Evidence'],
  };
  var NO_SKILL_SET = {};
  Object.keys(NO_SKILL).forEach(function (family) {
    NO_SKILL_SET[family] = {};
    NO_SKILL[family].forEach(function (n) {
      NO_SKILL_SET[family][n.toLowerCase()] = true;
    });
  });

  /* The skill a competency stands for in this kind of class: { key, name,
     skill }, or null when the table has none for its label. */
  function skillOf(family, label) {
    var rows = SKILLS[family] || [];
    var t = String(label || '');
    if (NO_SKILL_SET[family] && NO_SKILL_SET[family][t.toLowerCase()]) return null;
    for (var i = 0; t && i < rows.length; i++)
      if (rows[i].match.test(t)) return { key: rows[i].key, name: rows[i].name, skill: rows[i].skill };
    return null;
  }

  /* The bank's comment entry for a competency imported from the BC bank
     (tag.bank_id): its cluster's phrase, SKILLS key and next steps by level
     (data/bc-curriculum-comment.json, shipped as shared/bank-comment.js).
     A cluster with no SKILLS key gets its own key, so no line written for a
     table skill is bound to it. null when the id is not in the bank. */
  function bankEntry(bankId) {
    var b = typeof window !== 'undefined' ? window.BANK_COMMENT : null;
    var i = b && b.ids ? b.ids[bankId] : null;
    var row = i != null && b.clusters ? b.clusters[i] : null;
    if (!row) return null;
    return {
      key: row[1] || 'bank.' + i,
      phrase: row[0],
      steps: { Emerging: row[2], Developing: row[3], Proficient: row[4] },
    };
  }

  /* The skill a comment names a competency by: the bank's phrase for its
     cluster when it came from the bank (Colin, 2026-11-02: one phrase per
     cluster, by bank id), else the table's skill for its label (skillOf),
     for classes not re-linked to the bank. { key, name, skill, steps? } or
     null. */
  function skillFor(f, c) {
    if (!c) return null;
    var e = c.bankId ? bankEntry(c.bankId) : null;
    if (e) return { key: e.key, name: c.name, skill: e.phrase, steps: e.steps };
    return skillOf(f.family, c.name);
  }

  /* ── The class's lines (plan PR 8) ─────────────────────────────────── */

  /* Support lines a teacher can tick for a class: what they will do in
     class. FullVision never puts one in a comment the teacher did not
     choose. `families` limits a line to some kinds of class (none: every
     class); `fits` names the skills (SKILLS keys) and habits (HABITS keys)
     the line helps with, so each student gets the one that fits. */
  var SUPPORT_LINES = [
    { id: 'sl-missing', text: 'In class, I will ask about missing work each week.', fits: ['completes'] },
    {
      id: 'sl-revise',
      text: 'In class, there will be time to revise one piece using feedback.',
      fits: ['feedback', 'revising', 'testing'],
    },
    {
      id: 'sl-checklist',
      text: 'In class, I will give a short checklist for each assignment.',
      fits: ['completes', 'ready', 'conventions'],
    },
    {
      id: 'sl-sources',
      families: ['socials'],
      text: 'In class, I will give feedback on source work each week.',
      fits: ['evidence', 'perspective', 'significance', 'inquiry'],
    },
    {
      id: 'sl-paragraph',
      families: ['socials', 'ela'],
      text: 'In class, I will model how to plan a paragraph before writing.',
      fits: ['cause', 'continuity', 'ethical', 'writing', 'thinking', 'reading'],
    },
    {
      id: 'sl-partner-sources',
      families: ['socials'],
      text: 'In class, I will pair the student with a partner for source work.',
      fits: ['evidence', 'perspective', 'inquiry', 'others'],
    },
    {
      id: 'sl-drafts',
      families: ['ela'],
      text: 'In class, I will give feedback on each draft before the final copy.',
      fits: ['writing', 'revising', 'conventions'],
    },
    {
      id: 'sl-partner-reading',
      families: ['ela'],
      text: 'In class, I will pair the student with a partner to talk about the reading.',
      fits: ['reading', 'speaking', 'thinking', 'part'],
    },
    {
      id: 'sl-labs',
      families: ['science'],
      text: 'In class, I will give feedback on each lab write-up.',
      fits: ['communicating', 'processing', 'evaluating'],
    },
    {
      id: 'sl-plan-lab',
      families: ['science'],
      text: 'In class, I will model how to plan an investigation before starting it.',
      fits: ['planning', 'questioning'],
    },
    {
      id: 'sl-partner-lab',
      families: ['science'],
      text: 'In class, I will pair the student with a partner for lab work.',
      fits: ['planning', 'processing', 'others'],
    },
    {
      id: 'sl-steps',
      families: ['math'],
      text: 'In class, I will check the steps on practice problems each week.',
      fits: ['communicating', 'reasoning', 'solving'],
    },
    {
      id: 'sl-model-steps',
      families: ['math'],
      text: 'In class, I will model how to show each step of a solution.',
      fits: ['communicating', 'reasoning'],
    },
    {
      id: 'sl-partner-math',
      families: ['math'],
      text: 'In class, I will pair the student with a partner for problem solving.',
      fits: ['solving', 'connecting', 'others'],
    },
    {
      id: 'sl-progress',
      families: ['arts'],
      text: 'In class, I will give feedback on each piece while it is in progress.',
      fits: ['creating', 'technique', 'reflecting'],
    },
    {
      id: 'sl-plan-piece',
      families: ['arts'],
      text: 'In class, I will model how to plan a piece before starting it.',
      fits: ['creating', 'connecting'],
    },
    {
      id: 'sl-partner-arts',
      families: ['arts'],
      text: 'In class, I will pair the student with a partner to give and get feedback.',
      fits: ['reflecting', 'communicating', 'others'],
    },
    {
      id: 'sl-one-skill',
      families: ['pe'],
      text: 'In class, I will give one skill to focus on each unit.',
      fits: ['movement', 'fitness'],
    },
    {
      id: 'sl-partner-pe',
      families: ['pe'],
      text: 'In class, I will pair the student with a partner for skill practice.',
      fits: ['movement', 'leading', 'others'],
    },
    {
      id: 'sl-stages',
      families: ['adst'],
      text: 'In class, I will check each stage of a project with the student.',
      fits: ['designing', 'making', 'testing'],
    },
    {
      id: 'sl-plan-project',
      families: ['adst'],
      text: 'In class, I will model how to plan a project before starting it.',
      fits: ['designing', 'tools'],
    },
    {
      id: 'sl-goals',
      families: ['career'],
      text: 'In class, I will talk about goals and plans each month.',
      fits: ['planning', 'self', 'exploring'],
    },
    // Grown 2026-11-01: more lines in the plan's "In class, I will…" shape,
    // for any class and for each kind. Each is used exactly as written once
    // ticked, so every one passes the lint (tests/comment-bank-lint.test.js).
    {
      id: 'sl-help',
      text: 'In class, I will ask the student each week what help is needed.',
      fits: ['feedback', 'part', 'completes'],
    },
    {
      id: 'sl-week-plan',
      text: 'In class, I will plan the coming week with the student at its start.',
      fits: ['completes', 'ready'],
    },
    {
      id: 'sl-start',
      text: 'In class, I will help the student begin each task in the first five minutes.',
      fits: ['ready'],
    },
    {
      id: 'sl-feedback-talk',
      text: 'In class, I will talk with the student about feedback before the next piece.',
      fits: ['feedback', 'revising', 'testing', 'reflecting'],
    },
    {
      id: 'sl-one-question',
      text: 'In class, I will ask the student one question in each discussion.',
      fits: ['part', 'speaking'],
    },
    {
      id: 'sl-group-role',
      text: 'In class, I will give the student a clear role in each group task.',
      fits: ['others', 'leading'],
    },
    {
      id: 'sl-phones',
      text: 'In class, I will expect phones to be away at the start of each lesson.',
      fits: ['devices'],
    },
    {
      id: 'sl-missing-plan',
      text: 'In class, I will make a plan with the student for each piece labelled Missing.',
      fits: ['completes'],
    },
    {
      id: 'sl-finish-time',
      text: 'In class, I will give time each week to finish work that is in progress.',
      fits: ['completes'],
    },
    {
      id: 'sl-example',
      text: 'In class, I will show an example of finished work before each assignment.',
      fits: ['ready', 'completes'],
    },
    {
      id: 'sl-monthly-goal',
      text: 'In class, I will set one goal with the student each month and review it together.',
      fits: ['feedback', 'completes', 'ready'],
    },
    {
      id: 'sl-paragraph-feedback',
      families: ['socials'],
      text: 'In class, I will give feedback on one paragraph each week before the final copy.',
      fits: ['cause', 'continuity', 'ethical', 'significance'],
    },
    {
      id: 'sl-name-source',
      families: ['socials'],
      text: 'In class, I will ask the student to name the source behind each claim.',
      fits: ['evidence', 'inquiry'],
    },
    {
      id: 'sl-two-sources',
      families: ['socials'],
      text: 'In class, I will give two sources for each question and ask how they differ.',
      fits: ['perspective', 'evidence'],
    },
    {
      id: 'sl-read-draft',
      families: ['ela'],
      text: 'In class, I will read one paragraph of the draft with the student each week.',
      fits: ['writing', 'revising', 'conventions'],
    },
    {
      id: 'sl-text-question',
      families: ['ela'],
      text: 'In class, I will ask the student one question about what the class read in each discussion.',
      fits: ['reading', 'thinking', 'speaking'],
    },
    {
      id: 'sl-source-list',
      families: ['ela'],
      text: 'In class, I will give a short list of sources to start each research task.',
      fits: ['information'],
    },
    {
      id: 'sl-predict',
      families: ['science'],
      text: 'In class, I will ask the student to predict the result before each experiment.',
      fits: ['questioning', 'planning'],
    },
    {
      id: 'sl-graph-feedback',
      families: ['science'],
      text: 'In class, I will give feedback on each graph before the write-up is marked.',
      fits: ['processing', 'communicating'],
    },
    {
      id: 'sl-everyday',
      families: ['science'],
      text: 'In class, I will ask the student to explain one everyday example of each idea.',
      fits: ['applying', 'evaluating'],
    },
    {
      id: 'sl-worked-example',
      families: ['math'],
      text: 'In class, I will give a worked example to keep for each type of problem.',
      fits: ['solving', 'communicating'],
    },
    {
      id: 'sl-explain-aloud',
      families: ['math'],
      text: 'In class, I will ask the student to explain one solution aloud each week.',
      fits: ['reasoning', 'communicating'],
    },
    {
      id: 'sl-practice-set',
      families: ['math'],
      text: 'In class, I will give a short set of practice problems with answers for each unit.',
      fits: ['solving', 'connecting'],
    },
    {
      id: 'sl-choice-note',
      families: ['arts'],
      text: 'In class, I will ask the student to write a short note about one choice in each piece.',
      fits: ['reflecting', 'communicating'],
    },
    {
      id: 'sl-two-ideas',
      families: ['arts'],
      text: 'In class, I will give time to try two ideas before the student chooses one.',
      fits: ['creating', 'connecting'],
    },
    {
      id: 'sl-technique',
      families: ['arts'],
      text: 'In class, I will give one technique to practise each week and check it with the student.',
      fits: ['technique'],
    },
    {
      id: 'sl-fitness-goal',
      families: ['pe'],
      text: 'In class, I will set a fitness goal with the student and check it each month.',
      fits: ['fitness', 'wellbeing'],
    },
    {
      id: 'sl-warm-up',
      families: ['pe'],
      text: 'In class, I will give the student a turn leading one warm-up each unit.',
      fits: ['leading', 'part'],
    },
    {
      id: 'sl-safety',
      families: ['pe'],
      text: 'In class, I will review the safety rules with the student before each new activity.',
      fits: ['safety'],
    },
    {
      id: 'sl-test-record',
      families: ['adst'],
      text: 'In class, I will ask the student to test each project and record what changed.',
      fits: ['testing', 'making', 'sharing'],
    },
    {
      id: 'sl-sketch-check',
      families: ['adst'],
      text: 'In class, I will check the sketch and measurements before any cutting or building starts.',
      fits: ['designing', 'tools'],
    },
    {
      id: 'sl-tool-safe',
      families: ['adst'],
      text: 'In class, I will ask the student to show one tool being used safely each week.',
      fits: ['tools', 'making'],
    },
    {
      id: 'sl-goal-step',
      families: ['career'],
      text: 'In class, I will ask the student to write one step toward a goal each week.',
      fits: ['planning', 'self'],
    },
    {
      id: 'sl-research-time',
      families: ['career'],
      text: 'In class, I will give time each week to research one career.',
      fits: ['exploring'],
    },
    {
      id: 'sl-reflect',
      families: ['career'],
      text: 'In class, I will ask the student to reflect on one experience each month.',
      fits: ['connecting', 'self'],
    },
    // Adapted 2026-11-01 from the school's comment bank (`src` "GHS <code>";
    // docs/comment-bank-school-codes.md): the codes no gradebook fact can
    // select, rewritten as what the teacher will do in class.
    {
      id: 'sl-ghs-ask',
      text: 'In class, I will ask the student each week whether any part of the lesson is unclear.',
      fits: ['feedback', 'part'],
      src: 'GHS 36, 420, 446',
    },
    {
      id: 'sl-ghs-clear',
      text: 'In class, I will ask the student during work periods whether the task is clear.',
      fits: ['ready', 'feedback'],
      src: 'GHS Humanities',
    },
    {
      id: 'sl-ghs-detail',
      families: ['socials', 'ela'],
      text: 'In class, I will check the level of detail in the student’s work during each work period.',
      fits: ['evidence', 'significance', 'writing', 'thinking', 'reading'],
      src: 'GHS Humanities',
    },
    {
      id: 'sl-ghs-draft',
      families: ['socials', 'ela'],
      text: 'In class, I will look at the student’s draft during work periods before the final copy is due.',
      fits: ['revising', 'writing', 'conventions', 'evidence', 'cause', 'continuity'],
      src: 'GHS Humanities',
    },
    {
      id: 'sl-ghs-aloud',
      families: ['socials', 'ela'],
      text: 'In class, I will ask the student to explain an idea aloud before writing it.',
      fits: ['writing', 'thinking', 'reading', 'evidence', 'significance', 'perspective'],
      src: 'GHS Humanities',
    },
    {
      id: 'sl-ghs-full-sentences',
      families: ['science'],
      text: 'In class, I will expect full-sentence answers and mark where more detail is needed.',
      fits: ['communicating', 'evaluating'],
      src: 'GHS 527',
    },
    {
      id: 'sl-ghs-process',
      families: ['math'],
      text: 'In class, I will ask the student to show the process for one problem each day.',
      fits: ['communicating', 'reasoning'],
      src: 'GHS 611',
    },
    {
      id: 'sl-ghs-demo',
      families: ['adst', 'arts', 'science'],
      text: 'In class, I will repeat each demonstration for the student before the practical work starts.',
      fits: ['making', 'tools', 'technique', 'planning'],
      src: 'GHS 184, 188, 401',
    },
    {
      id: 'sl-ghs-rehearse',
      families: ['arts'],
      text: 'In class, I will give time to practise the hardest part of a piece.',
      fits: ['technique', 'creating'],
      src: 'GHS 238, 475',
    },
    // Second languages (round three, lane I, Nov 1): lines in the same
    // shape for a French, Spanish, Punjabi, Japanese or ASL class. Each
    // says "the language" and "use the language", so it holds for a
    // signed language as for a spoken one.
    {
      id: 'sl-lang-turn',
      families: ['languages'],
      text: 'In class, I will give the student a turn to use the language with a partner each lesson.',
      fits: ['speaking', 'communicating', 'part'],
    },
    {
      id: 'sl-lang-words',
      families: ['languages'],
      text: 'In class, I will review the new words from each unit with the student each week.',
      fits: ['vocabulary'],
    },
    {
      id: 'sl-lang-message',
      families: ['languages'],
      text: 'In class, I will play or show a short message in the language and check its main idea.',
      fits: ['listening', 'understanding'],
    },
    {
      id: 'sl-lang-text',
      families: ['languages'],
      text: 'In class, I will read a short text in the language with the student and ask what it is about.',
      fits: ['reading', 'understanding'],
    },
    {
      id: 'sl-lang-paragraph',
      families: ['languages'],
      text: 'In class, I will look at one paragraph in the language with the student before the final copy.',
      fits: ['writing', 'grammar'],
    },
    {
      id: 'sl-lang-form',
      families: ['languages'],
      text: 'In class, I will give one verb form or marker to practise each week and check it with the student.',
      fits: ['grammar'],
    },
    {
      id: 'sl-lang-guess',
      families: ['languages'],
      text: 'In class, I will model how to guess an unknown word from the words around it.',
      fits: ['understanding', 'vocabulary'],
    },
    {
      id: 'sl-lang-gesture',
      families: ['languages'],
      text: 'In class, I will model another word or a gesture to use when a word in the language is missing.',
      fits: ['communicating', 'speaking'],
    },
    {
      id: 'sl-lang-custom',
      families: ['languages'],
      text: 'In class, I will give time each unit to explore one custom from a community that uses the language.',
      fits: ['culture'],
    },
    {
      id: 'sl-lang-partner',
      families: ['languages'],
      text: 'In class, I will pair the student with a partner for practice in the language.',
      fits: ['speaking', 'listening', 'communicating', 'others'],
    },
    {
      id: 'sl-lang-question',
      families: ['languages'],
      text: 'In class, I will ask the student one question in the language in each lesson.',
      fits: ['speaking', 'listening', 'part'],
    },
    {
      id: 'sl-lang-feedback',
      families: ['languages'],
      text: 'In class, I will give feedback on each piece in the language before the next one is due.',
      fits: ['writing', 'grammar', 'feedback'],
    },
  ];

  /* ── Language Goals (plan PR 3b; the school's ELL lines) ────────────── */

  /* Lines for a student assessed on language goals (reporting_basis
     'language_goals'): FullVision has no language-proficiency facts, so
     no rule selects one. The teacher ticks the lines used in a class and
     picks one per student from the Language Goals row; the comment leaves
     the sentence out until one is picked. Each says what the student can
     do in English and one next step, never the designation (the fixed
     Statement says that). Templates: {He} and both verb forms, filled by
     the realiser like a bank sentence. Adapted 2026-11-01 from the
     school's ELL comment sheet (`src` "GHS <code>";
     docs/comment-bank-school-codes.md). */
  var LANGUAGE_GOAL_LINES = [
    {
      id: 'lg-discussions',
      text: '{He} can follow class discussions in English and join small-group talk; the next step is one idea in whole-class talk.',
      src: 'GHS 303, 304',
    },
    {
      id: 'lg-speaks',
      text: '{He} can say new words in English after hearing them; the next step is using them in a sentence.',
      src: 'GHS 302',
    },
    {
      id: 'lg-instructions',
      text: '{He} can follow spoken instructions in English; the next step is requesting a repeat when one step is unclear.',
      src: 'GHS 309',
    },
    {
      id: 'lg-one-step',
      text: '{He} can follow spoken instructions in English one step at a time; the next step is two steps given together.',
      src: 'GHS 308',
    },
    {
      id: 'lg-vocabulary',
      text: '{He} can use new words from class in {his} writing; the next step is reviewing the new words each week.',
      src: 'GHS 310',
    },
    {
      id: 'lg-reads-aloud',
      text: '{He} can read a text aloud in English; the next step is answering a question about what it says.',
      src: 'GHS 311',
    },
    {
      id: 'lg-in-time',
      text: '{He} can complete assignments in English in the time given; the next step is adding more detail to {his} answers.',
      src: 'GHS 313',
    },
    {
      id: 'lg-extra-time',
      text: '{He} can complete assignments in English; the next step is finishing one in the time given.',
      src: 'GHS 314',
    },
    {
      id: 'lg-with-support',
      text: '{He} can complete assignments in English after asking one question; the next step is completing one without asking.',
      src: 'GHS 312',
    },
    {
      id: 'lg-writing',
      text: '{His} writing in English has grown this term; the next step is a paragraph with one clear main idea.',
      src: 'GHS 315',
    },
    {
      id: 'lg-takes-part',
      text: '{He} [takes|take] part in class by speaking in English; the next step is taking part in writing as well.',
      src: 'GHS 307',
    },
    {
      id: 'lg-translation',
      text: '{He} can follow instructions in English when written as well as spoken; the next step is spoken instructions alone.',
      src: 'GHS 317',
    },
    {
      id: 'lg-reading',
      text: '{He} can read short texts in English; the next step is a longer text with a question about it.',
      src: 'GHS 319, 321',
    },
    {
      id: 'lg-listening',
      text: '{He} can follow English spoken slowly in class; the next step is following it at the usual pace.',
      src: 'GHS 320',
    },
    {
      id: 'lg-outside',
      text: '{He} can speak, read and write in English in class; the next step is using English with others between lessons.',
      src: 'GHS 306',
    },
  ];

  /* The support lines on offer for a kind of class, in order. */
  function supportLinesFor(family) {
    return SUPPORT_LINES.filter(function (l) {
      return !l.families || l.families.indexOf(family) >= 0;
    });
  }

  /* The character limit as typed in its box: { ok: true, limit } for a
     whole number from LIMIT_MIN to LIMIT_MAX (limit null when the box is
     empty: no limit), else { ok: false }. A stray letter, 0, a negative or
     a decimal is never read as "no limit". */
  var LIMIT_MIN = 100;
  var LIMIT_MAX = 5000;
  function parseLimit(value) {
    var t = String(value == null ? '' : value).trim();
    if (t === '') return { ok: true, limit: null };
    if (!/^\d+$/.test(t)) return { ok: false };
    var n = Number(t);
    return n >= LIMIT_MIN && n <= LIMIT_MAX ? { ok: true, limit: n } : { ok: false };
  }
  /* A saved limit: a whole number above 0, as older code saved it (one
     below 100 is honoured as is; only a new entry is held to parseLimit).
     Anything else is none. */
  function _savedLimit(v) {
    var n = Math.floor(Number(v));
    return v != null && v !== '' && n > 0 ? n : null;
  }

  /* A class's comment settings, kept in its report settings (report_config,
     under blocks_config.commentSettings): the support lines it ticked and
     wrote, each student's own pick per report ({ termId: { sid: line id or
     'none' } }), the closing sentence and the character limit (null: no
     limit). The late-work line is the class's Late Work Policy. */
  function classSettings(cid) {
    var rc = (typeof getReportConfig === 'function' && getReportConfig(cid)) || {};
    var cs = (rc && rc.commentSettings) || {};
    return {
      supportChosen: Array.isArray(cs.supportChosen) ? cs.supportChosen.map(String) : [],
      supportOwn: Array.isArray(cs.supportOwn)
        ? cs.supportOwn.filter(function (l) {
            return l && l.id && String(l.text || '').trim();
          })
        : [],
      supportFor: cs.supportFor && typeof cs.supportFor === 'object' ? cs.supportFor : {},
      // The Language Goals list (LANGUAGE_GOAL_LINES): the lines ticked for
      // the class, the teacher's own, and each student's pick per report.
      languageGoalsChosen: Array.isArray(cs.languageGoalsChosen) ? cs.languageGoalsChosen.map(String) : [],
      languageGoalsOwn: Array.isArray(cs.languageGoalsOwn)
        ? cs.languageGoalsOwn.filter(function (l) {
            return l && l.id && String(l.text || '').trim();
          })
        : [],
      languageGoalsFor: cs.languageGoalsFor && typeof cs.languageGoalsFor === 'object' ? cs.languageGoalsFor : {},
      closing: String(cs.closing || '').trim(),
      charLimit: _savedLimit(cs.charLimit),
    };
  }

  /* The class's checklist: the lines on offer for its kind of class, then
     the teacher's own, each { id, text, fits, own, on }. */
  function supportChecklist(cid, family) {
    var cs = classSettings(cid);
    var on = function (id) {
      return cs.supportChosen.indexOf(String(id)) >= 0;
    };
    return supportLinesFor(family)
      .map(function (l) {
        return { id: l.id, text: l.text, fits: l.fits.slice(), own: false, on: on(l.id) };
      })
      .concat(
        cs.supportOwn.map(function (l) {
          return { id: String(l.id), text: String(l.text).trim(), fits: [], own: true, on: on(l.id) };
        }),
      );
  }

  /* The class's Language Goals checklist: the built-in lines, then the
     teacher's own, each { id, text, own, on }. */
  function languageGoalsChecklist(cid) {
    var cs = classSettings(cid);
    var on = function (id) {
      return cs.languageGoalsChosen.indexOf(String(id)) >= 0;
    };
    return LANGUAGE_GOAL_LINES.map(function (l) {
      return { id: l.id, text: l.text, own: false, on: on(l.id) };
    }).concat(
      cs.languageGoalsOwn.map(function (l) {
        return { id: String(l.id), text: String(l.text).trim(), own: true, on: on(l.id) };
      }),
    );
  }

  /* What the comment needs of the class's lines for one student this
     report: { support: the ticked lines, pick: this student's own pick
     (a line id, 'none' to leave the sentence out, or null), languageGoals:
     the ticked Language Goals lines, goalPick: this student's pick among
     them (a line id or null), closing, late, charLimit }. Teacher text is
     used exactly as typed. */
  function classLines(cid, sid, termId, family) {
    var cs = classSettings(cid);
    var course = (typeof COURSES !== 'undefined' && COURSES[cid]) || {};
    var picks = (termId && cs.supportFor[termId]) || {};
    var pick = picks[sid] != null ? String(picks[sid]) : null;
    var goalPicks = (termId && cs.languageGoalsFor[termId]) || {};
    var goalPick = goalPicks[sid] != null ? String(goalPicks[sid]) : null;
    return {
      support: supportChecklist(cid, family).filter(function (l) {
        return l.on;
      }),
      pick: pick,
      languageGoals: languageGoalsChecklist(cid).filter(function (l) {
        return l.on;
      }),
      goalPick: goalPick,
      closing: cs.closing,
      late: String(course.lateWorkPolicy || '').trim(),
      charLimit: cs.charLimit,
    };
  }

  /* The Language Goals line in this student's comment: their own pick for
     this report among the class's ticked lines, else null (no rule picks
     one; the row asks the teacher to). Only on the language-goals path.
     { line, mine: true }. */
  function languageGoalChoice(f) {
    var cl = (f && f.classLines) || {};
    if (reportPath(f) !== 'language_goals' || !cl.goalPick) return null;
    var line = (cl.languageGoals || []).find(function (l) {
      return l.id === cl.goalPick;
    });
    return line ? { line: line, mine: true } : null;
  }

  var PER_GROUP = 2;
  var USED_BY = 3;
  var NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

  /* The realiser (teacher/comment-realiser.js) owns the sentence grammar:
     lists, numbers, a or an, titles, the name and pronouns (plan PR 9). */
  var R = window.CommentRealiser;
  /* "a", "a and b", "a, b and c" (no serial comma); a name given twice once. */
  var list = R.list;

  /* A level rounded as it prints (3.07 and 3.1 are the same figure). */
  function tenths(v) {
    return Math.round(Number(v) * 10);
  }
  function word(v) {
    return v > 0 ? PROF_LABELS[Math.max(1, Math.min(4, Math.round(v)))] || '' : '';
  }

  /* Completes Work from the assignment record, until the teacher picks: all
     in, none late or missing is Consistently; more than two missing is
     Rarely; any missing or more than two late is Sometimes; else Usually.
     Nothing with no record. */
  function completesFromRecord(rec) {
    if (!rec || !(rec.total > 0)) return undefined;
    if (rec.handed === rec.total && !rec.late && !rec.missing) return CONSISTENTLY;
    if (rec.missing > 2) return 1;
    if (rec.missing || rec.late > 2) return 2;
    return 3;
  }

  /* Whether the record can say anything about Completes Work: not on the
     IE path while the student has work with no mark yet, since that work
     is part of the IE problem and the record cannot tell whether it came
     in on time. */
  function _unmarkedIe(f) {
    if (!f || reportPath(f) !== 'ie') return false;
    var m = (f.grade && f.grade.marked) || {};
    return m.all > 0 && (m.mine || 0) < m.all;
  }

  /* The habits a sentence is matched against: the teacher's, with Completes
     Work from the record while the teacher has not picked it (never on the
     IE path while work has no mark yet: only the teacher's ratings there).
     `f`: the facts, when known. */
  function effectiveHabits(stored, rec, f) {
    var out = {};
    HABITS.forEach(function (h) {
      var v = stored && Number(stored[h.key]);
      if (v >= 1 && v <= NOT_SEEN) out[h.key] = v;
    });
    if (!('completes' in out) && !_unmarkedIe(f)) {
      var auto = completesFromRecord(rec);
      if (auto) out.completes = auto;
    }
    return out;
  }

  /* What the habits sentence says (plan PR 7), from the ratings in force
     (effectiveHabits), Not Seen and unrated habits left out:
     - excellent: all six have a rating and every one seen is Consistently;
     - good: all six have a rating, none Sometimes or Rarely, not all
       Consistently;
     - build: the one or two to build, rated Sometimes or Rarely, lowest
       first, ties in the grid's order (more than two: the two lowest);
     - strong: the habits rated Consistently, in the grid's order;
     - seen: every habit rated Rarely to Consistently.
     With nothing rated, all are empty and there is no habits sentence. */
  function habitSummary(habits) {
    habits = habits || {};
    var key = function (h) {
      return h.key;
    };
    var seen = HABITS.filter(function (h) {
      return habits[h.key] >= 1 && habits[h.key] < NOT_SEEN;
    });
    var allRated = HABITS.every(function (h) {
      return habits[h.key] >= 1 && habits[h.key] <= NOT_SEEN;
    });
    var weak = seen
      .filter(function (h) {
        return habits[h.key] <= 2;
      })
      .sort(function (a, b) {
        return habits[a.key] - habits[b.key] || HABITS.indexOf(a) - HABITS.indexOf(b);
      });
    var strong = seen.filter(function (h) {
      return habits[h.key] === CONSISTENTLY;
    });
    var excellent = allRated && seen.length > 0 && strong.length === seen.length;
    return {
      excellent: excellent,
      good: allRated && seen.length > 0 && !weak.length && !excellent,
      build: weak.slice(0, 2).map(key),
      strong: strong.map(key),
      seen: seen.map(key),
    };
  }

  /* The IE comment's habits sentence: the habits rated Consistently (keys,
     at most three, the grid's order) as one sentence, "He comes to class
     ready, takes part and works well with others." They/them when no
     pronouns are on file. '' with none. As tokens for the
     realiser (strengthsTokens), the verb agreeing with whoever starts it. */
  function strengthsTokens(f, ks) {
    if (!ks || !ks.length) return null;
    var p = f.pronouns || { subj: 'they', poss: 'their' };
    var phrases = function (form) {
      return list(
        ks.map(function (k) {
          return habitWords(k, form, f.family || '', p);
        }),
      );
    };
    return [{ ref: 'subj' }, ' ', { verb: [phrases('does'), phrases('do')] }, '.'];
  }
  function strengthsSentence(f, ks) {
    var toks = strengthsTokens(f, ks);
    return toks ? R.render(toks, _whoOfFacts(f), { named: true }) : '';
  }
  /* The same strong habits as a verb phrase after the student, for the
     Strong Habits frames (bank hs13-hs16): "{He} {strongHabits}." gives
     "He comes to class ready, takes part and works well with others." The
     tokens hold both verb forms, agreeing with the mention before them;
     the string is the form for this student's pronouns. */
  function strongHabitsTokens(f, ks) {
    var toks = strengthsTokens(f, ks);
    return toks ? [toks[2]] : null;
  }
  function strongHabitsPhrase(f, ks) {
    var toks = strongHabitsTokens(f, ks);
    if (!toks) return '';
    // Rendered by the realiser after the student as subject, so its
    // pronoun rule (they/them with none on file) and verb agreement
    // decide the form; the subject is then dropped.
    return R.render([{ ref: 'subj' }, ' ', toks[0]], _whoOfFacts(f), { named: true }).replace(/^\S+\s+/, '');
  }
  /* Who a comment is about, for the realiser: { name, p, onFile }. */
  function _whoOfFacts(f) {
    return { name: f.name, p: f.pronouns, onFile: !!f.pronounsOnFile };
  }

  /* Text that ends a sentence: its own . ! ? or … kept, else a period. */
  function _ended(text) {
    var t = String(text || '').trim();
    if (!t) return '';
    return /[.!?…]$/.test(t) ? t : t + '.';
  }
  function _quote(text) {
    var t = _ended(text);
    return t ? '“' + t + '”' : '';
  }
  function _answer(it) {
    return it && it.v && it.v.text ? String(it.v.text).trim() : '';
  }

  /* ── The best-piece sentence (plan, Sentence grammar) ──────────────── */

  /* A title as a comment quotes it: the lesson number ("4.3 ", "Lesson 2:")
     dropped. A title that is only a number keeps it. */
  var workTitle = R.workTitle;

  /* The teacher's Note for the Report as the sentence uses it: one line,
     its first letter lower case when it starts a plain word ("Linked" →
     "linked"), no closing period (the sentence adds its own). A note that
     does not start with a past-tense verb (CommentLint.startsPastTense:
     "clear graphs and a careful method") is left out, so the sentence
     takes its no-note form; the grader's card says why. */
  function reportNoteText(note) {
    var t = String(note || '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.\s]+$/, '');
    if (!t) return '';
    var lint = window.CommentLint;
    if (lint && lint.startsPastTense && !lint.startsPastTense(t)) return '';
    if (/^[A-Z][a-z]/.test(t)) t = t.charAt(0).toLowerCase() + t.slice(1);
    return t;
  }

  /* The note as the {bestNote} slot: reportNoteText, without a closing ! ?
     or …, since the frame ends the sentence itself. */
  function noteSlot(note) {
    return reportNoteText(note).replace(/[!?…\s]+$/, '');
  }

  /* "{His} best piece was “{title}”, where {he} {note}." With no note:
     "{His} best piece was “{title}.”", or with the skill the piece shows
     (o.skill, bestPieceSkillOf): "{His} best piece was “{title},” which
     shows {he} can {skill}." A title's own ? or ! stays inside the
     quotes; the period ends inside the closing quote, any comma after it.
     As tokens for the realiser, so the name moves to it when it comes
     first. o: { title, note }. null with no title. */
  function bestPieceTokens(o) {
    o = o || {};
    var title = workTitle(o.title);
    if (!title) return null;
    var note = reportNoteText(o.note);
    var piece = { value: title, title: true };
    if (!note && o.skill)
      return [{ ref: 'poss' }, ' best piece was ', piece, ', which shows ', { ref: 'subj' }, ' can ' + o.skill + '.'];
    if (!note) return [{ ref: 'poss' }, ' best piece was ', piece, '.'];
    return [
      { ref: 'poss' },
      ' best piece was ',
      piece,
      ', where ',
      { ref: 'subj' },
      ' ' + note + (/[!?…]$/.test(note) ? '' : '.'),
    ];
  }
  /* The best-piece sentence where it usually sits, after the first: the
     student's pronouns, they/them when none are on file. o: { title, note,
     name, pronouns, onFile }. '' with no title. */
  function bestPieceSentence(o) {
    o = o || {};
    var toks = bestPieceTokens(o);
    return toks ? R.render(toks, { name: o.name, p: o.pronouns, onFile: !!o.onFile }, { named: true }) : '';
  }

  /* ── The work-not-handed-in sentence (plan, Sentence grammar) ──────── */

  var numberWords = R.numberWords;
  var numberIn = R.numberIn;
  function _cap(w) {
    return w ? w.charAt(0).toUpperCase() + w.slice(1) : '';
  }

  /* A title in quotes as the end of a sentence: the period inside the
     closing quote, a title's own ? or ! in place of it. */
  function _quotedEnd(title) {
    return R.finish(R.quoteTitle(title) + '.');
  }
  var _quotedMid = R.quoteTitle;

  /* The work labelled Missing as one sentence: "One assignment is not
     handed in: “{title}.”"; two titles joined with "and"; three or more
     as the count, with the largest group of three or more titles sharing
     the words before a colon ("Fifteen assignments are not handed in,
     including six Current Events assignments."). Nothing else is inferred.
     nh: notHandedIn() { count, titles, groups }. '' with none. */
  function notHandedInSentence(nh) {
    var n = (nh && nh.count) || 0;
    var titles = (nh && nh.titles) || [];
    if (!n) return '';
    if (n === 1 && titles[0]) return 'One assignment is not handed in: ' + _quotedEnd(titles[0]);
    if (n === 2 && titles[0] && titles[1])
      return 'Two assignments are not handed in: ' + _quotedMid(titles[0]) + ' and ' + _quotedEnd(titles[1]);
    var group = nh.groups && nh.groups[0];
    return (
      _cap(numberWords(n)) +
      ' assignments are not handed in' +
      (group ? ', including ' + numberIn(group.count) + ' ' + group.name + ' assignments.' : '.')
    );
  }
  /* The same facts as slots, for the Not Handed In frames (bank m02-m21):
     title (one, quoted) when exactly one is labelled Missing; titles
     ("“A” and “B”") when exactly two; many ('yes') when three or more with
     no group; group ("six Current Events assignments") when there is one.
     Each is '' otherwise, so a frame fits only the case its wording
     states. The count is the missingCount slot. */
  function missingSlots(nh) {
    var n = (nh && nh.count) || 0;
    var titles = (nh && nh.titles) || [];
    var group = nh && nh.groups && nh.groups[0];
    return {
      title: n === 1 && titles[0] ? _quotedMid(titles[0]) : '',
      titles: n === 2 && titles[0] && titles[1] ? _quotedMid(titles[0]) + ' and ' + _quotedMid(titles[1]) : '',
      many: n >= 3 && !group ? 'yes' : '',
      group: n >= 3 && group ? numberIn(group.count) + ' ' + group.name + ' assignments' : '',
    };
  }

  /* The name and pronouns a sentence about this student uses. */
  function studentRef(student) {
    var p = ReportBlocks.getPronouns(student);
    return { name: displayNameFirst(student), pronouns: p, onFile: p.onFile };
  }

  /* ── What FullVision has ───────────────────────────────────────────── */

  /* The work labelled Missing, oldest first: { count, titles, groups }.
     A group is three or more titles sharing the words before a colon
     ("Current Events: Week 3"), as { name, count }, largest first. */
  function notHandedIn(list, dateOf) {
    var sorted = list.slice().sort(function (x, y) {
      return (
        String(dateOf(x)).localeCompare(String(dateOf(y))) || String(x.title || '').localeCompare(String(y.title || ''))
      );
    });
    var titles = sorted.map(function (a) {
      return String(a.title || '').trim();
    });
    var byName = {};
    var order = [];
    titles.forEach(function (t) {
      var i = t.indexOf(':');
      var name = i > 0 ? t.slice(0, i).trim() : '';
      if (!name) return;
      if (!byName[name]) {
        byName[name] = 0;
        order.push(name);
      }
      byName[name]++;
    });
    var groups = order
      .filter(function (name) {
        return byName[name] >= 3;
      })
      .map(function (name) {
        return { name: name, count: byName[name] };
      })
      .sort(function (x, y) {
        return y.count - x.count;
      });
    return { count: titles.length, titles: titles, groups: groups };
  }

  /* Whether an assessment is in the active term, and its date: the term's
     work and its competencies' scores read the same rule. */
  function _inTerm(cid, a) {
    return !!a && assessmentInActiveTerm(cid, a);
  }
  function _dateOf(a) {
    return (typeof _assessmentDate === 'function' ? _assessmentDate(a) : a.date) || '';
  }

  /* One student's competencies this term, with a level now (calc.js
     startAndNow): every score per competency, oldest to newest, its level at
     the start of the term and now. The comment's gates (strongestOf,
     nextStepOf) and the printed This Term at a Glance read the same list,
     so they name the same competencies. Reads no DOM. */
  function compsOf(cid, student) {
    var sid = student.id;
    var byId = {};
    (getAssessments(cid) || []).forEach(function (a) {
      byId[a.id] = a;
    });
    var inTerm = function (a) {
      return _inTerm(cid, a);
    };
    var dateOf = _dateOf;
    // A teacher's override is the competency's level in a term with
    // evidence (DECISIONS, overrides), as calc.js getSectionProficiency has it.
    var overrides = (typeof getOverrides === 'function' && (getOverrides(cid) || {})[sid]) || {};
    var sections = ReportBlocks.reportSections(cid);
    return sections
      .map(function (sec) {
        var scores = [];
        (sec.tags || []).forEach(function (tag) {
          // One point per piece of work: a rubric's criteria on the
          // competency average into it (calc.js tagScoresByAssessment).
          tagScoresByAssessment(cid, sid, tag.id).forEach(function (sc) {
            var a = byId[sc.assessmentId];
            if (!(sc.score > 0) || !inTerm(a) || !dateOf(a)) return;
            scores.push({ id: a.id, v: Number(sc.score), d: dateOf(a), title: a.title || '' });
          });
        });
        scores.sort(function (x, y) {
          return x.d.localeCompare(y.d);
        });
        var sn = startAndNow(
          scores.map(function (s) {
            return { t: Math.round(parseLocalDate(s.d).getTime() / 86400000), v: s.v };
          }),
        );
        var iCans = [];
        (sec.tags || []).forEach(function (t) {
          (t.i_can_statements || []).forEach(function (s) {
            if (String(s || '').trim()) iCans.push(String(s).trim());
          });
        });
        return {
          id: sec.id,
          // The competency's own label, as the printed report names it; the
          // section name is the curriculum category, shared by several.
          name: ReportBlocks.competencyLabel(sec),
          // The bank id of its first competency from the BC bank, for the
          // phrase and next steps a comment names it by (skillFor).
          bankId:
            (
              (sec.tags || []).find(function (t) {
                return !!t.bank_id;
              }) || {}
            ).bank_id || null,
          scores: scores,
          start: sn ? sn.start : 0,
          now: sn ? sn.now : 0,
          // The level now even without dated scores, for strengths; the
          // teacher's override when there is evidence this term.
          level:
            sn && overrides[sec.id] && overrides[sec.id].level > 0
              ? overrides[sec.id].level
              : sn
                ? sn.now
                : getSectionProficiency(cid, sid, sec.id),
          iCans: iCans,
        };
      })
      .filter(function (c) {
        return c.level > 0;
      });
  }

  /* One student's term, from the data layer. Reads no DOM. */
  function facts(cid, student, termId) {
    var sid = student.id;
    var course = (typeof COURSES !== 'undefined' && COURSES[cid]) || {};
    var assessments = getAssessments(cid) || [];
    var inTerm = function (a) {
      return _inTerm(cid, a);
    };
    var dateOf = _dateOf;

    var sections = ReportBlocks.reportSections(cid);
    var comps = compsOf(cid, student);

    // The assessed work this term, one level per assessment.
    var work = assessments
      .filter(function (a) {
        return inTerm(a) && !(typeof isCompletionScored === 'function' && isCompletionScored(a));
      })
      .map(function (a) {
        var v = getAssessmentOverallScore(cid, sid, a.id);
        // The teacher's Note for the Report on the piece, for the best-piece sentence.
        var note = typeof getScoreReportNote === 'function' ? getScoreReportNote(cid, sid, a.id) : '';
        // Points work's own % (points earned out of possible, calc.js), the
        // mark a Letter class prints for it (workMark): its level is only a
        // band of that %.
        var pc = isPointsScored(a) ? getAssessmentGroupPercentage(cid, sid, [a]) : null;
        var pct = pc && pc.pct != null ? pc.pct : null;
        return v > 0 ? { id: a.id, title: a.title || '', d: dateOf(a), v: v, pct: pct, note: note } : null;
      })
      .filter(Boolean);

    // Handed In, Late, Missing: the Missing Work block's rule. Work is
    // missing only when it is labelled Missing, whatever its due date.
    var rec = { total: 0, handed: 0, late: 0, missing: 0 };
    var notIn = [];
    // The scored pieces this term with their % (calc.js), oldest first, for
    // the grade sentence's "close to" (gradeOf). Work labelled Missing is
    // not a scored piece.
    var pieces = [];
    assessments.filter(inTerm).forEach(function (a) {
      var cell = assessmentCellValue(cid, sid, a);
      var missing = cell.status === 'NS';
      if (missing) notIn.push(a);
      var scored = ['level', 'points', 'complete'].indexOf(cell.kind) >= 0;
      if (!missing && !scored) return;
      rec.total++;
      if (missing) rec.missing++;
      else rec.handed++;
      if (cell.late) rec.late++;
      if (missing || !dateOf(a)) return;
      var pc = getAssessmentGroupPercentage(cid, sid, [a]);
      if (pc && pc.pct != null) pieces.push({ id: a.id, d: dateOf(a), pct: pc.pct });
    });
    pieces.sort(function (x, y) {
      return String(x.d).localeCompare(String(y.d));
    });

    var term = typeof getActiveTerm === 'function' ? getActiveTerm(cid) : null;

    // Student Voice.
    var entries =
      typeof StudentVoice !== 'undefined' && StudentVoice.entries ? StudentVoice.entries(cid, sid) || [] : [];
    var prof = entries.length && StudentVoice.profile ? StudentVoice.profile(entries) : null;
    var about = prof && prof.about;
    var checkin = prof && prof.checkin;
    var aboutGoal = about ? _answer(about.goal).split(/\n\s*\n/)[0] : '';
    var voice = {
      entries: entries,
      profile: prof,
      good: about ? _answer(about.goodAt) : '',
      hard: about ? _answer(about.hard) : '',
      goal: (checkin && _answer(checkin.coreGoal)) || aboutGoal,
      goalStatus: checkin && checkin.status ? _answer(checkin.status) : '',
      plan: checkin ? _answer(checkin.next) : '',
      private: about ? _answer(about.note) : '',
    };

    // The student's confidence per competency (Reflections), strongest and least.
    var refl = (typeof getReflections === 'function' && (getReflections(cid) || {})[sid]) || {};
    var conf = Object.keys(refl)
      .map(function (secId) {
        var sec = sections.find(function (s) {
          return s.id === secId;
        });
        var c = refl[secId] && Number(refl[secId].confidence);
        return sec && c > 0 ? { id: secId, name: sec.name, c: c } : null;
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return b.c - a.c;
      });

    var overall = getOverallProficiency(cid, sid);
    var mode = courseGradeMode(cid);
    var letter =
      mode !== 'proficiency' && typeof getCourseLetterData === 'function' ? getCourseLetterData(cid, sid) : null;
    // The report's own Focus Area before any pick (the biggest change), so
    // the choices keep their order when the teacher picks one.
    var focus = ReportBlocks.focusArea(cid, student, { termId: termId }, 'change');
    var att = getTermAttendance(cid, sid, termId) || {};
    var rating = getStudentTermRating(cid, sid, termId) || {};
    // What the report prints for the grade (calc.js reportingBasis) and the
    // IE's deadline; the student's marks against the class's marked work,
    // for the teacher's IE choice; the designations that offer language or
    // IEP goals.
    var marked = markedCounts(cid, sid, assessments.filter(inTerm));
    var des = student.designations || [];
    // When the student joined the class (enrollment.enrolled_at), and the
    // class's first enrolment, for the new-to-the-class story (angle()).
    var day = function (v) {
      return v ? String(v).slice(0, 10) : '';
    };
    var classStart = (getStudents(cid) || [])
      .map(function (s) {
        return day(s.enrolledDate);
      })
      .filter(Boolean)
      .sort()[0];

    // The class's support lines, closing sentence and late-work line, and
    // this student's own support pick for this report (plan PR 8).
    var family = familyOf(cid);
    var pronouns = ReportBlocks.getPronouns(student);

    return {
      cid: cid,
      sid: sid,
      name: displayNameFirst(student),
      first: student.firstName || displayNameFirst(student),
      course: course.name || '',
      family: family,
      pronouns: pronouns,
      pronounsOnFile: pronouns.onFile,
      comps: comps,
      work: work,
      record: rec,
      notHandedIn: notHandedIn(notIn, dateOf),
      voice: voice,
      confidence: conf,
      overall: overall,
      standing: mode !== 'letter' && overall > 0 ? word(overall) : '',
      letter: letter && letter.S ? (/^[AFI]/.test(letter.S) ? 'an ' : 'a ') + letter.S + ' (' + letter.R + '%)' : '',
      // The course grade for the grade sentence, all from calc.js: the class's
      // grading style, the letter and % as shown, the band above, and the
      // scored pieces (gradeOf).
      grade: {
        mode: mode,
        letter: letter && letter.R != null ? percentageToLetter(letter.R, cid) : null,
        pct: letter && letter.R != null ? letter.R : null,
        next: letter && letter.R != null ? nextLetterBand(letter.R) : null,
        pieces: pieces,
        basis: typeof reportingBasis === 'function' ? reportingBasis(cid, sid, termId) : 'grade',
        ieDeadline: String(rating.ieDeadline || '').slice(0, 10),
        // false once the saved date has passed or falls after the school
        // year: the comment then says no deadline until a new one is picked.
        ieDeadlineOk: !rating.ieDeadline || deadlineOk(cid, rating.ieDeadline),
        ieAllowed: ieAllowed(cid),
        marked: marked,
        ell: des.indexOf('ELL') >= 0,
        iep: des.some(function (c) {
          return typeof BC_DESIGNATIONS !== 'undefined' && !!BC_DESIGNATIONS[c] && !!BC_DESIGNATIONS[c].iep;
        }),
      },
      levelText: function (v) {
        return mode === 'letter' ? formatLevel(cid, v) : levelWord(cid, v);
      },
      defaultFocusId: (focus && focus.sec && focus.sec.id) || null,
      focusId: rating.focusSectionId || (focus && focus.sec && focus.sec.id) || null,
      absent: att.absencesThisTerm,
      late: att.latesThisTerm,
      habits: rating.habits || {},
      enrolled: day(student.enrolledDate),
      classStart: classStart || '',
      termStart: (term && term.startsOn) || '',
      classLines: classLines(cid, sid, termId, family),
    };
  }

  /* Whether a class can report IE: a Letter or Both class (grades 10–12);
     a class whose grade level is set and below 10 cannot. */
  function ieAllowed(cid) {
    if (courseGradeMode(cid) === 'proficiency') return false;
    var course = (typeof COURSES !== 'undefined' && COURSES[cid]) || {};
    var grades = String(course.gradeLevel || '').match(/\d+/g);
    return (
      !grades ||
      grades.some(function (g) {
        return Number(g) >= 10;
      })
    );
  }

  /* The work the class has marks on this term (any student has a mark),
     and how much of it this student has a mark on: { mine, all }. Work the
     student is excused from is not counted for them. */
  function markedCounts(cid, sid, list) {
    var students = getStudents(cid) || [];
    var isMark = function (cell) {
      return ['level', 'points', 'complete'].indexOf(cell.kind) >= 0;
    };
    var out = { mine: 0, all: 0 };
    list.forEach(function (a) {
      var any = students.some(function (s) {
        return isMark(assessmentCellValue(cid, s.id, a));
      });
      if (!any) return;
      var cell = assessmentCellValue(cid, sid, a);
      if (cell.status === 'EXC') return;
      out.all++;
      if (isMark(cell)) out.mine++;
    });
    return out;
  }

  /* The Focus Area choices: the report's Focus Area first, then the
     competencies whose level changed most this term, ties to the lowest now.
     A Focus Area the teacher saved is always one of them (in the last place
     when it is no longer in the top three), so the comment and the printed
     report never disagree. */
  function focusOptions(f, picked) {
    var withLevels = f.comps.filter(function (c) {
      return c.start > 0 && c.now > 0;
    });
    var sorted = withLevels.slice().sort(function (a, b) {
      var ca = Math.abs(tenths(a.now) - tenths(a.start));
      var cb = Math.abs(tenths(b.now) - tenths(b.start));
      return cb - ca || a.now - b.now;
    });
    var first = withLevels.find(function (c) {
      return c.id === (f.defaultFocusId || f.focusId);
    });
    var out = first ? [first] : [];
    sorted.forEach(function (c) {
      if (out.length < 3 && out.indexOf(c) < 0) out.push(c);
    });
    var saved =
      picked &&
      f.comps.find(function (c) {
        return c.id === picked;
      });
    if (saved && out.indexOf(saved) < 0) {
      if (out.length >= 3) out.pop();
      out.push(saved);
    }
    return out;
  }

  /* ── The slots ─────────────────────────────────────────────────────── */

  /* The picture of the term that picks an opening: early with no levels to
     compare; challenge when any competency is Developing or Emerging now;
     strong when one is Extending or more rose than fell; else steady. */
  function pictureOf(comps) {
    var withLevels = comps.filter(function (c) {
      return c.start > 0 && c.now > 0;
    });
    if (!withLevels.length) return 'early';
    var nowWords = withLevels.map(function (c) {
      return word(c.now);
    });
    if (
      nowWords.some(function (w) {
        return w === 'Developing' || w === 'Emerging';
      })
    )
      return 'challenge';
    var rises = withLevels.filter(function (c) {
      return tenths(c.now) > tenths(c.start);
    }).length;
    var drops = withLevels.filter(function (c) {
      return tenths(c.now) < tenths(c.start);
    }).length;
    return nowWords.indexOf('Extending') >= 0 || rises > drops ? 'strong' : 'steady';
  }

  /* What the assessed work shows overall, from the overall level. */
  var EVIDENCE = {
    solid: 'a good understanding of the course material',
    growing: 'progress toward understanding the key concepts',
  };
  /* The mark a comment prints beside a piece of work, as the class shows
     it (levelText); in a Letter class, points work prints its own % (points
     earned out of possible, calc.js), the same number the gradebook works
     out, never its level as a %. */
  function workMark(f, w) {
    if (!w) return '';
    if (f.grade && f.grade.mode === 'letter' && w.pct != null) return Math.round(w.pct) + '%';
    return f.levelText(w.v);
  }

  function evidenceOf(f) {
    if (!f.work.length) return '';
    return f.overall >= 2.5 ? EVIDENCE.solid : EVIDENCE.growing;
  }

  /* ── The grade sentence ────────────────────────────────────────────── */

  /* The standing words of the Letter Grades Order (M192/94). IE and F have
     none, so they get no grade sentence here. */
  var STANDING = { A: 'excellent', B: 'very good', 'C+': 'good', C: 'satisfactory', 'C-': 'minimally acceptable' };
  /* "Close to" the next letter: at most this many points below its band,
     with at least this many scored pieces. */
  var CLOSE_POINTS = 2;
  var CLOSE_PIECES = 6;

  /* "a" or "an" by sound: a letter grade or initialism is said letter by
     letter ("an A", "a B", "an IE"); a word by its first sound ("an
     Extending", "a Proficient"). The realiser's rule (R.article). */
  var aOrAn = R.aOrAn;

  function _median(xs) {
    var s = xs.slice().sort(function (a, b) {
      return a - b;
    });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* Whether the marks are going down: the scored pieces in date order, and
     the median % of the latest third below the median of the earliest
     third. Fewer than three pieces show no trend. */
  function trendingDown(pieces) {
    var xs = (pieces || []).slice().sort(function (a, b) {
      return String(a.d).localeCompare(String(b.d));
    });
    var n = Math.floor(xs.length / 3);
    if (n < 1) return false;
    var pct = function (p) {
      return Number(p.pct);
    };
    return _median(xs.slice(-n).map(pct)) < _median(xs.slice(0, n).map(pct));
  }

  /* The next letter up when the student is close to it: { letter, min,
     gap }, or null. Only upward, only within CLOSE_POINTS of the band, with
     CLOSE_PIECES or more scored pieces and no downward trend. */
  function closeTo(g) {
    var nx = g && g.next;
    if (!nx || g.pct == null) return null;
    var gap = Math.round((nx.min - Number(g.pct)) * 10) / 10;
    if (!(gap > 0) || gap > CLOSE_POINTS) return null;
    if ((g.pieces || []).length < CLOSE_PIECES || trendingDown(g.pieces)) return null;
    return { letter: nx.letter, min: nx.min, gap: gap };
  }

  /* ── IE, language goals and IEP goals (plan PR 3) ───────────────────── */

  /* The teacher may choose IE when the student has marks on fewer than half
     the work the class has marks on (a Letter or Both class, grades 10–12). */
  function ieOffered(f) {
    var g = (f && f.grade) || {};
    var m = g.marked || {};
    return g.ieAllowed !== false && (g.mode === 'letter' || g.mode === 'both') && m.all > 0 && m.mine * 2 < m.all;
  }
  /* The goals the student can be assessed against instead of a letter: an
     ELL designation offers language goals, an IEP designation IEP goals.
     Only where there is a letter to replace (a Letter or Both class). */
  function goalsOffered(f) {
    var g = (f && f.grade) || {};
    if (g.mode !== 'letter' && g.mode !== 'both') return [];
    var out = [];
    if (g.ell) out.push('language_goals');
    if (g.iep) out.push('iep_goals');
    return out;
  }
  /* The path the comment takes: 'language_goals' or 'iep_goals' when the
     teacher chose goals; 'ie' when the teacher chose IE, or calc.js reports
     IE (under 50% before the course ends); '' for the grade sentence. */
  function reportPath(f) {
    var g = (f && f.grade) || {};
    if (g.mode !== 'letter' && g.mode !== 'both') return '';
    if (g.basis === 'language_goals' || g.basis === 'iep_goals') return g.basis;
    if (g.ieAllowed !== false && (g.basis === 'ie' || g.letter === 'IE')) return 'ie';
    return '';
  }
  /* Where an IE comes from: 'teacher' (the stored choice) or 'calc'. */
  function ieSource(f) {
    return reportPath(f) !== 'ie' ? '' : f.grade.basis === 'ie' ? 'teacher' : 'calc';
  }
  /* What an IE comment names as the problem: work labelled Missing first,
     then marks on less of the work than the class has ('noMarks' with
     none), then a mark under 50%. '' when none of these holds. */
  function ieProblemOf(f) {
    if (reportPath(f) !== 'ie') return '';
    if (_missingCount(f) > 0) return 'missing';
    var m = (f.grade && f.grade.marked) || {};
    if (m.all > 0 && !m.mine) return 'noMarks';
    if (m.all > 0 && m.mine < m.all) return 'marks';
    if (f.grade.pct != null && Number(f.grade.pct) < 50) return 'low';
    return '';
  }
  /* The deadline as the comment says it ("December 18"), or '' until the
     teacher picks one: no Deadline sentence is drafted until then (Colin,
     Nov 2: "Withhold the deadline until a date is picked"). */
  function deadlineText(iso) {
    var d = String(iso || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
    var date = typeof parseLocalDate === 'function' ? parseLocalDate(d) : new Date(d + 'T00:00:00');
    return isNaN(date) ? '' : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }

  /* The school year a deadline is picked in: the class's first reporting
     term's start to its last term's end; with no terms, September 1 to June
     30 of the school year today falls in. { start, end } as YYYY-MM-DD. */
  function schoolYear(cid, today) {
    var terms = typeof getReportingTerms === 'function' ? getReportingTerms(cid) : [];
    var starts = terms
      .map(function (t) {
        return t.starts_on;
      })
      .filter(Boolean)
      .sort();
    var ends = terms
      .map(function (t) {
        return t.ends_on;
      })
      .filter(Boolean)
      .sort();
    if (starts.length && ends.length) return { start: starts[0], end: ends[ends.length - 1] };
    var y = Number(String(today).slice(0, 4));
    var fall = Number(String(today).slice(5, 7)) >= 8;
    return { start: (fall ? y : y - 1) + '-09-01', end: (fall ? y + 1 : y) + '-06-30' };
  }
  function _todayFor(cid) {
    return typeof courseToday === 'function' ? courseToday(cid) : new Date().toISOString().slice(0, 10);
  }
  /* The days a deadline can fall on: from today (or the year's start) to
     the end of the school year. { min, max } as YYYY-MM-DD. */
  function deadlineRange(cid, today) {
    today = today || _todayFor(cid);
    var yr = schoolYear(cid, today);
    return { min: today > yr.start ? today : yr.start, max: yr.end };
  }
  /* Whether a saved deadline can stand: a real date from today to the last
     school day. One that has passed, or falls after the school year, is
     treated as not picked: no Deadline sentence, Approve and Next off. */
  function deadlineOk(cid, iso, today) {
    var d = String(iso || '').slice(0, 10);
    if (!deadlineText(d)) return false;
    var r = deadlineRange(cid, today);
    return d >= r.min && d <= r.max;
  }
  /* The deadline the comment says, '' until a date is picked that can
     stand (deadlineOk, through the facts). */
  function _deadlineOf(f) {
    var g = (f && f.grade) || {};
    return g.ieDeadlineOk === false ? '' : deadlineText(g.ieDeadline);
  }

  /* The placeholder a Deadline sentence said before a date was picked,
     in comments saved before Nov 2. */
  var DATE_PLACEHOLDER = '[date]';

  /* Whether a sentence holds the date as a whole: "December 1" is not in
     "December 18". */
  function _holdsDate(text, date) {
    if (!date) return false;
    var at = String(text || '').indexOf(date);
    while (at >= 0) {
      if (!/[0-9]/.test(text.charAt(at + date.length))) return true;
      at = text.indexOf(date, at + 1);
    }
    return false;
  }

  /* A comment with the old [date] placeholder dealt with: each sentence
     that holds it is taken out while no deadline is picked (`iso` empty),
     else the placeholder says the date. Everything else stays as written.
     A comment without the placeholder comes back unchanged. With `ok`
     false the saved date cannot stand (deadlineOk): it counts as not
     picked, and the Deadline sentence that says it (the date and "IE") is
     taken out too until a new date is picked. */
  function withDeadline(text, iso, ok) {
    var t = String(text == null ? '' : text);
    var stale = ok === false ? deadlineText(iso) : '';
    var staleIn = function (piece) {
      return !!stale && _holdsDate(piece, stale) && /\bIE\b/.test(piece);
    };
    if (t.indexOf(DATE_PLACEHOLDER) < 0 && !staleIn(t)) return t;
    var date = ok === false ? '' : deadlineText(iso);
    if (date) return t.split(DATE_PLACEHOLDER).join(date);
    // The comment's sentences with the space after each, ended by . ! ? or
    // … (and a closing quote) where the next sentence starts.
    var re = /[.!?…]+["”]?(\s+|$)/g;
    var out = '';
    var from = 0;
    var m;
    var keep = function (piece) {
      if (piece.indexOf(DATE_PLACEHOLDER) < 0 && !staleIn(piece)) out += piece;
    };
    while ((m = re.exec(t))) {
      if (!m[0]) {
        re.lastIndex++;
        continue;
      }
      keep(t.slice(from, m.index + m[0].length));
      from = m.index + m[0].length;
    }
    if (from < t.length) keep(t.slice(from));
    // The sentence taken out was the last: no space left trailing.
    return /\s$/.test(t) ? out : out.replace(/\s+$/, '');
  }

  /* What the grade sentence says, from the facts: { kind, letter,
     standing, next } in a Letter or Both class, { kind: 'proficiency',
     word } in a Proficiency class, { kind: 'ie' } on the IE path, {
     kind: 'languageGoals' | 'iepGoals' } when the teacher chose goals, or
     null when there is no grade sentence (no marks yet, or F). kind picks
     the bank sentence: letter, letterClose, cminus, cminusClose,
     proficiency, ie, languageGoals, iepGoals. */
  function gradeOf(f) {
    var g = (f && f.grade) || {};
    var path = reportPath(f);
    if (path === 'ie') return { kind: 'ie' };
    if (path === 'language_goals') return { kind: 'languageGoals' };
    if (path === 'iep_goals') return { kind: 'iepGoals' };
    if (g.mode === 'proficiency') return f.standing ? { kind: 'proficiency', word: f.standing } : null;
    if (g.mode !== 'letter' && g.mode !== 'both') return null;
    var standing = g.letter && STANDING[g.letter];
    if (!standing) return null;
    var close = closeTo(g);
    return {
      kind: (g.letter === 'C-' ? 'cminus' : 'letter') + (close ? 'Close' : ''),
      letter: g.letter,
      standing: standing,
      next: close ? close.letter : '',
    };
  }

  /* The grade sentence's slot values for a gradeOf result. */
  function gradeSlots(gr) {
    return {
      gradeLetter: gr && gr.letter ? aOrAn(gr.letter) : '',
      gradeStanding: (gr && gr.standing) || '',
      gradeNext: gr && gr.next ? aOrAn(gr.next) : '',
      gradeWord: (gr && gr.word) || '',
    };
  }

  /* ── Evidence gates ────────────────────────────────────────────────── */

  /* Every "strongest" and "improved" claim passes its gate here, and only
     here (plan PR 6; research report, section D, recommendation 6). The
     story picker (angle()), the slots (context()), selection (fits()), the
     verifier (CLAIMS) and the At a Glance tags all read these. Below a gate
     the claiming sentence is not eligible, and verify() fails it. */
  // Strongest needs 3+ scored pieces: the 3-score minimum used in practice (report D6).
  var STRONGEST_PIECES = 3;
  // And half a proficiency step over the next competency, a gap larger than one mark's noise (report D6).
  var STRONGEST_GAP = 0.5;
  // Improved needs 4+ pieces, so the change is not one mark against another (report D6).
  var IMPROVED_PIECES = 4;
  // Over 4+ weeks, so a few days of marks are not a trend (report D6).
  var IMPROVED_DAYS = 28;
  // The smallest change that counts, in proficiency (half a step, as for strongest) or in % (#554's 5 points).
  var IMPROVED_LEVEL = 0.5;
  var IMPROVED_POINTS = 5;

  function _days(a, b) {
    var x = typeof parseLocalDate === 'function' ? parseLocalDate(a) : new Date(a);
    var y = typeof parseLocalDate === 'function' ? parseLocalDate(b) : new Date(b);
    return (y - x) / 86400000;
  }
  function _byDate(points) {
    return (points || []).slice().sort(function (a, b) {
      return String(a.d).localeCompare(String(b.d));
    });
  }
  /* The median of the latest third less the median of the earliest third,
     in date order (thirds of at least one point). */
  function _thirdsChange(xs) {
    var n = Math.floor(xs.length / 3);
    if (n < 1) return null;
    var val = function (p) {
      return Number(p.v);
    };
    return _median(xs.slice(-n).map(val)) - _median(xs.slice(0, n).map(val));
  }
  // Compare in thousandths, so 3.3 - 2.8 counts as half a step.
  function _atLeast(change, step) {
    return change != null && Math.round(change * 1000) >= Math.round(step * 1000);
  }

  /* The change over the term, comparing the medians of the earliest and
     latest thirds by date: 4+ pieces over 4+ weeks (report D6), else null.
     points: [{ d, v }], v a proficiency or a %. */
  function trendOf(points) {
    var xs = _byDate(points);
    if (xs.length < IMPROVED_PIECES || !(_days(xs[0].d, xs[xs.length - 1].d) >= IMPROVED_DAYS)) return null;
    return _thirdsChange(xs);
  }

  /* "Improved": the trend is up by `step` or more, and still is with the
     earliest third's lowest score left out, so a gain that rests on one low
     early score (regression to the mean, report D6) is not claimed. */
  function improvedGate(points, step) {
    if (!_atLeast(trendOf(points), step)) return false;
    var xs = _byDate(points);
    var early = xs.slice(0, Math.floor(xs.length / 3));
    var low = early.reduce(function (m, p) {
      return Number(p.v) < Number(m.v) ? p : m;
    }, early[0]);
    return _atLeast(
      _thirdsChange(
        xs.filter(function (p) {
          return p !== low;
        }),
      ),
      step,
    );
  }

  /* A competency's scores as points: { d, v } with v its proficiency. */
  function improvedComp(c) {
    return !!c && improvedGate(c.scores, IMPROVED_LEVEL);
  }

  /* The scored pieces' % as points, for the climb and slide stories. */
  function _pctPoints(pieces) {
    return (pieces || []).map(function (p) {
      return { d: p.d, v: Number(p.pct) };
    });
  }
  function climbed(pieces) {
    return improvedGate(_pctPoints(pieces), IMPROVED_POINTS);
  }
  function slid(pieces) {
    var t = trendOf(_pctPoints(pieces));
    return t != null && _atLeast(-t, IMPROVED_POINTS);
  }

  /* "Strongest": the top competency, or the top two when the first is not
     half a step clear of the second, resting on 3+ scored pieces each and
     half a proficiency step or more over the next competency (report D6).
     [] when none passes. */
  function strongestOf(comps) {
    var xs = (comps || [])
      .filter(function (c) {
        return c.level > 0;
      })
      .sort(function (a, b) {
        return b.level - a.level;
      });
    for (var k = 1; k <= 2 && xs.length > k; k++) {
      var top = xs.slice(0, k);
      var enough = top.every(function (c) {
        return (c.scores || []).length >= STRONGEST_PIECES;
      });
      if (enough && _atLeast(top[k - 1].level - xs[k].level, STRONGEST_GAP)) return top;
    }
    return [];
  }

  /* The next step (plan PR 8): the lowest competency with enough evidence,
     3+ scored pieces this term (the "strongest" gate's minimum), and not
     among the strongest; the first in report order on an exact tie. null when
     none has enough. The comment's next-step sentence and the At a Glance
     tag both read it. */
  function nextStepOf(comps) {
    var strong = strongestOf(comps);
    var low = null;
    (comps || []).forEach(function (c) {
      if (!(c.level > 0) || (c.scores || []).length < STRONGEST_PIECES || strong.indexOf(c) >= 0) return;
      if (!low || c.level < low.level) low = c;
    });
    return low;
  }

  /* The skill the next step names, from the table: { comp, key, name,
     skill }, or null when there is no next step or the table has no skill
     for it. */
  function nextSkillOf(f) {
    var c = nextStepOf(f.comps);
    var sk = skillFor(f, c);
    return sk ? { comp: c, key: sk.key, name: sk.name, skill: sk.skill, steps: sk.steps || null } : null;
  }

  /* The next step at the student's level (Colin, 2026-11-02): for a bank
     competency, its cluster's step toward the level above the next-step
     competency's level now; at Extending, the phrase itself. { comp, text }
     or null for a competency with no bank entry. */
  function levelStepOf(f) {
    var n = nextSkillOf(f);
    if (!n || !n.steps) return null;
    return { comp: n.comp, text: n.steps[word(n.comp.level)] || n.skill };
  }

  /* The next step most of the class shares (Colin, 2026-11-02), for the
     teacher's own closing line: each student's next step at their level
     (levelStepOf, a bank competency) or as the table's skill (nextSkillOf),
     counted across the students. { text, count, total }, or null when no
     step is shared by two or more. opts: { termId, students }. */
  function sharedNextStep(cid, opts) {
    var counts = {};
    var order = [];
    var total = 0;
    ((opts && opts.students) || []).forEach(function (st) {
      var f = facts(cid, st, opts.termId);
      total++;
      var ls = levelStepOf(f);
      var ns = ls ? null : nextSkillOf(f);
      var text = ls ? ls.text : ns ? ns.skill : '';
      if (!text) return;
      if (!counts[text]) order.push(text);
      counts[text] = (counts[text] || 0) + 1;
    });
    var best = null;
    order.forEach(function (t) {
      if (!best || counts[t] > counts[best]) best = t;
    });
    if (!best || counts[best] < 2) return null;
    return { text: best, count: counts[best], total: total };
  }

  /* The strengths (plan, target comment part 3): the competencies past the
     "strongest" gate (strongestOf), each as its skill in plain words from
     the table, [{ comp, key, skill }]. A competency the table has no skill
     for is left out; the comment never prints a bare competency label. */
  function strengthSkills(f) {
    return strongestOf(f.comps)
      .map(function (c) {
        var sk = skillFor(f, c);
        return sk ? { comp: c, key: sk.key, skill: sk.skill, steps: sk.steps || null } : null;
      })
      .filter(Boolean);
  }
  /* The strengths as the sentences print them: "{strengths}" = one or two
     skills ("A and B"), "{strength}" = the first alone. '' with none. */
  function strengthsText(f) {
    return list(
      strengthSkills(f).map(function (x) {
        return x.skill;
      }),
    );
  }
  function strengthText(f) {
    var xs = strengthSkills(f);
    return xs.length ? xs[0].skill : '';
  }
  /* The first strength where the student is now (Colin, 2026-11-02): for a
     competency from the BC bank, its cluster's phrase and the level word it
     is at, which the frame says with the Ministry qualifier ("is beginning
     to", "with growing consistency", "consistently", "with depth and
     complexity"). The strongest gate already needs 3+ pieces. { comp, key,
     skill, word } or null. */
  /* Progress in levels over the term (Colin, 2026-11-02): a competency from
     the BC bank that climbed a level or more from the start of the term to
     now, past the "improved" gate (improvedComp), named by its level words
     and its cluster's phrase: "Maya rose from Developing to Proficient in
     her ability to explain the causes and results of an event." The largest
     climb; never the next step's skill (one sentence per skill); only where
     the class shows proficiency words (f.standing), and only while the
     phrase leaves the sentence within 20 words (9 words at most). { comp,
     key, from, to, skill } or null. */
  function progressOf(f) {
    if (!f.standing) return null;
    var next = nextSkillOf(f);
    var pick = null;
    (f.comps || []).forEach(function (c) {
      var e = c.bankId ? bankEntry(c.bankId) : null;
      if (!e || (next && next.key === e.key)) return;
      // The level reached is the competency's level as the report shows it
      // (c.level: a teacher's override where there is one).
      var from = word(c.start);
      var to = word(c.level);
      if (!from || !to || !(Math.round(c.level) > Math.round(c.start)) || !improvedComp(c)) return;
      if (R.wordCount(e.phrase) > 9) return;
      var gain = Math.round(c.level) - Math.round(c.start);
      if (!pick || gain > pick.gain) pick = { comp: c, key: e.key, from: from, to: to, skill: e.phrase, gain: gain };
    });
    return pick;
  }

  function strengthNowOf(f) {
    var x = strengthSkills(f)[0];
    if (!x || !x.steps) return null;
    var w = word(x.comp.level);
    return w ? { comp: x.comp, key: x.key, skill: x.skill, word: w } : null;
  }

  /* The skill a best piece with no teacher note shows (Colin, 2026-11-02):
     of the competencies from the BC bank the piece was scored on at
     Proficient or above, the highest-scored (the first in report order on
     a tie), in its cluster's phrase. One sentence per skill: never a skill
     the comment can name elsewhere (the strengths, a tie at the top, even
     results, the highest-marked skill, the next step), by SKILLS key, and
     only while the sentence stays within 20 words. { comp, key, skill } or
     null; null with a note, which says what the piece shows itself. */
  function bestPieceSkillOf(f, w) {
    if (!w || reportNoteText(w.note)) return null;
    var taken = {};
    [strengthSkills(f), topTieSkills(f), evenSkills(f), highestSkills(f), [nextSkillOf(f)], [progressOf(f)]].forEach(
      function (xs) {
        (xs || []).forEach(function (x) {
          if (x) taken[x.key] = true;
        });
      },
    );
    var pick = null;
    var pickV = 0;
    (f.comps || []).forEach(function (c) {
      var sc = (c.scores || []).find(function (x) {
        return x.id === w.id;
      });
      var e = sc && c.bankId ? bankEntry(c.bankId) : null;
      if (!e || taken[e.key] || !(Math.round(Number(sc.v)) >= 3) || !(Number(sc.v) > pickV)) return;
      pick = { comp: c, key: e.key, skill: e.phrase };
      pickV = Number(sc.v);
    });
    if (!pick) return null;
    var text = bestPieceSentence({
      title: w.title,
      skill: pick.skill,
      name: f.name,
      pronouns: f.pronouns,
      onFile: f.pronounsOnFile,
    });
    return R.tooLong(text) ? null : pick;
  }

  /* The work this term, best first: the one rule for "best piece" that the
     comment and At a Glance both read (bestPieceOf). Of the pieces tied at
     the top (as the level prints, tenths), one scored on the strongest
     competency comes first, so the best piece backs up the strength (Colin,
     2026-11-02); then the higher mark, then the most recent. Only the
     "strongest" gate counts: a tie at the top names its skill by rotation
     across classmates (topSkillOf), which would move the best piece between
     sessions and flag approved comments as changed. */
  function bestOrderOf(f) {
    var strongSk = strengthSkills(f)[0];
    var strongComp = strongSk ? strongSk.comp : null;
    var onStrength = function (w) {
      return strongComp &&
        (strongComp.scores || []).some(function (s) {
          return s.id === w.id;
        })
        ? 1
        : 0;
    };
    return (f.work || []).slice().sort(function (a, b) {
      return tenths(b.v) - tenths(a.v) || onStrength(b) - onStrength(a) || b.v - a.v || String(b.d).localeCompare(a.d);
    });
  }
  /* The best piece this term (bestOrderOf), or null with no scored work. */
  function bestPieceOf(f) {
    return bestOrderOf(f)[0] || null;
  }

  /* A tie at the top (strengths for a tie, Nov 1): nothing passes the
     "strongest" gate; two or more competencies, each on 3+ scored pieces,
     sit within half a step of the highest, and every one of them is half a
     step or more over the rest, of which there is at least one. The tied
     competencies, highest first (report order on a tie); [] otherwise. A
     student whose every competency is within half a step is the even
     case (evenComps), not this one. One of the tied skills is named as a
     strength, "among the highest", never "strongest" (topSkillOf).
     A competency in the band on fewer than 3 pieces is left out of the tie
     and is not a blocker (Nov 1, strengths coverage): with 7+ competencies
     tagged four to an assessment, one thin competency near the top
     otherwise stopped every tie. It is not the rest either: the tie's
     lead is measured over the first competency below the band, whatever
     its piece count (as the "strongest" gate measures). */
  function topTieOf(comps) {
    if (strongestOf(comps).length) return [];
    var xs = (comps || [])
      .filter(function (c) {
        return c.level > 0;
      })
      .sort(function (a, b) {
        return b.level - a.level;
      });
    if (xs.length < 3) return [];
    var band = xs.filter(function (c) {
      return !_atLeast(xs[0].level - c.level, STRONGEST_GAP);
    });
    var rest = xs.filter(function (c) {
      return band.indexOf(c) < 0;
    });
    var tie = band.filter(function (c) {
      return (c.scores || []).length >= STRONGEST_PIECES;
    });
    if (tie.length < 2 || !rest.length) return [];
    if (!_atLeast(tie[tie.length - 1].level - rest[0].level, STRONGEST_GAP)) return [];
    return tie;
  }

  /* The tied competencies as skills from the table (one per skill key),
     [{ comp, key, skill }], the next step's competency left out (so the
     strengths sentence and the next step never name one skill). */
  function topTieSkills(f) {
    var out = [];
    var next = nextStepOf(f.comps);
    topTieOf(f.comps).forEach(function (c) {
      if (c === next) return;
      var sk = skillFor(f, c);
      if (
        !sk ||
        out.some(function (x) {
          return x.key === sk.key;
        })
      )
        return;
      out.push({ comp: c, key: sk.key, skill: sk.skill });
    });
    return out;
  }

  /* The skills named as a strength that was a choice, not a fact (one of a
     tie at the top, or one of a student's even results) in each class this
     session, per student: { cid: { sid: skill key } }. Kept in memory only,
     as _told. */
  var _topTold = {};
  function _topUsesFor(cid, sid) {
    var mine = (cid != null && _topTold[cid]) || {};
    var out = {};
    Object.keys(mine).forEach(function (k) {
      if (k !== String(sid)) out[mine[k]] = (out[mine[k]] || 0) + 1;
    });
    return out;
  }

  /* The student's strength as one skill: the strongest skill past the gate
     (strengthSkills), else one of a tie at the top (topTieSkills): the
     skill named for the fewest classmates this session, then the shortest
     wording, then the highest competency. { comp, key, skill } or null.
     The order is strongest, then the tie, then even results. */
  function topSkillOf(f) {
    var strong = strengthSkills(f);
    if (strong.length) return strong[0];
    var uses = _topUsesFor(f.cid, f.sid);
    var xs = topTieSkills(f);
    if (!xs.length) return null;
    return xs
      .map(function (x, i) {
        return { x: x, i: i };
      })
      .sort(function (a, b) {
        return (
          (uses[a.x.key] || 0) - (uses[b.x.key] || 0) || R.wordCount(a.x.skill) - R.wordCount(b.x.skill) || a.i - b.i
        );
      })[0].x;
  }

  /* Even results (bank expansion, round two): nothing passes the
     "strongest" gate; every competency with a level, whatever its piece
     count, is within half a proficiency step (the gap the gate needs) of
     the others and rounds to the overall proficiency word; and two or more
     are judged on 3+ scored pieces. So the frames' "every skill", "no
     skill far above another" and "{evenWord} across the skills" are true
     as written (the review of #613). The competencies, highest first
     (report order on a tie); [] when the results are not even. The
     even-results strengths frames (bank n5xx) are offered on this alone,
     so a student with level marks still gets a strengths sentence. */
  function evenComps(comps, overall) {
    if (strongestOf(comps).length) return [];
    var xs = (comps || []).filter(function (c) {
      return c.level > 0;
    });
    var judged = xs.filter(function (c) {
      return (c.scores || []).length >= STRONGEST_PIECES;
    });
    if (judged.length < 2) return [];
    var levels = xs.map(function (c) {
      return c.level;
    });
    if (_atLeast(Math.max.apply(null, levels) - Math.min.apply(null, levels), STRONGEST_GAP)) return [];
    var w = overall > 0 ? word(overall) : '';
    if (
      !w ||
      xs.some(function (c) {
        return word(c.level) !== w;
      })
    )
      return [];
    return xs.slice().sort(function (a, b) {
      return b.level - a.level;
    });
  }
  /* The even competencies as skills from the table (one per skill key),
     [{ comp, key, skill }]; the frames print the first ({evenSkill}). The
     next step's competency (nextStepOf) is left out, so the strengths
     sentence and the next step never name one skill. Every even competency
     is within half a step of the others, so any is a fair example: as for
     a tie (topSkillOf), the skill named for the fewest classmates this
     session comes first, then the shortest wording (which keeps the
     realised sentence within 20 words for more students), then the
     highest competency. Before Nov 1 the shortest always came first, so a
     class printed one clause for most of its even students. A frame too
     long with the first skill takes the next that fits (ctxFor). */
  function evenSkills(f) {
    var out = [];
    var next = nextStepOf(f.comps);
    var uses = _topUsesFor(f.cid, f.sid);
    evenComps(f.comps, f.overall).forEach(function (c) {
      // Only a competency judged on 3+ pieces is named as what the
      // student can do.
      if (c === next || (c.scores || []).length < STRONGEST_PIECES) return;
      var sk = skillFor(f, c);
      if (
        !sk ||
        out.some(function (x) {
          return x.key === sk.key;
        })
      )
        return;
      out.push({ comp: c, key: sk.key, skill: sk.skill });
    });
    return out
      .map(function (x, i) {
        return { x: x, i: i };
      })
      .sort(function (a, b) {
        return (
          (uses[a.x.key] || 0) - (uses[b.x.key] || 0) || R.wordCount(a.x.skill) - R.wordCount(b.x.skill) || a.i - b.i
        );
      })
      .map(function (p) {
        return p.x;
      });
  }
  /* "{evenSkill}": the first even skill alone, '' with none. */
  function evenSkillText(f) {
    var xs = evenSkills(f);
    return xs.length ? xs[0].skill : '';
  }

  /* The student's own highest-marked skill (strengths for a staircase,
     Nov 2): no other route holds (strongest, a tie at the top, even
     results), and two or more competencies are judged on 3+ scored pieces
     (one skill is not a pattern). The competencies at the highest
     proficiency among the judged ones, as it prints (tenths), the next
     step's left out; report order. [] otherwise. A fact about the student's
     own work, never a ranking against anyone else and never "strongest"
     (the frames say what the work shows in that skill at its proficiency
     word, `when.highestWord`). */
  function highestOf(comps, overall) {
    if (strongestOf(comps).length || topTieOf(comps).length || evenComps(comps, overall).length) return [];
    var judged = (comps || []).filter(function (c) {
      return c.level > 0 && (c.scores || []).length >= STRONGEST_PIECES;
    });
    if (judged.length < 2) return [];
    var next = nextStepOf(comps);
    var pool = judged.filter(function (c) {
      return c !== next;
    });
    if (!pool.length) return [];
    var top = Math.max.apply(
      null,
      pool.map(function (c) {
        return tenths(c.level);
      }),
    );
    return pool.filter(function (c) {
      return tenths(c.level) === top;
    });
  }
  /* The highest-marked competencies (highestOf) as skills from the table,
     one per skill key and never the next step's skill, [{ comp, key, skill,
     word }], word the competency's own proficiency word. As for a tie
     (topSkillOf), the skill named for the fewest classmates this session
     comes first, then the shortest wording, then report order. A frame too
     long with the first skill takes the next with the same word (ctxFor). */
  function highestSkills(f) {
    var next = nextSkillOf(f);
    var uses = _topUsesFor(f.cid, f.sid);
    var out = [];
    highestOf(f.comps, f.overall).forEach(function (c) {
      var sk = skillFor(f, c);
      if (
        !sk ||
        (next && next.key === sk.key) ||
        out.some(function (x) {
          return x.key === sk.key;
        })
      )
        return;
      out.push({ comp: c, key: sk.key, skill: sk.skill, word: word(c.level) });
    });
    return out
      .map(function (x, i) {
        return { x: x, i: i };
      })
      .sort(function (a, b) {
        return (
          (uses[a.x.key] || 0) - (uses[b.x.key] || 0) || R.wordCount(a.x.skill) - R.wordCount(b.x.skill) || a.i - b.i
        );
      })
      .map(function (p) {
        return p.x;
      });
  }
  /* Whether the highest-marked skill is at the top of every competency
     with a level, whatever its piece count: the frames that say "where
     {his} marks are highest" need it (`highestTop`), so a competency
     marked once or twice above it never makes them untrue. */
  function highestIsTop(f, x) {
    return (
      !!x &&
      !(f.comps || []).some(function (c) {
        return c.level > 0 && tenths(c.level) > tenths(x.comp.level);
      })
    );
  }

  /* What a support line fits for this student: the next step's skill when
     the line names it, else a habit rated Sometimes or Rarely that it
     names; null when neither. */
  function supportFit(line, f, habits) {
    var fits = (line && line.fits) || [];
    var next = nextSkillOf(f);
    if (next && fits.indexOf(next.key) >= 0) return next.key;
    return (
      fits.find(function (k) {
        return habits && (habits[k] === 1 || habits[k] === 2);
      }) || null
    );
  }

  /* A skill or habit key in words: the student's own competency for the
     next step's skill, else the table's name, else the habit's. */
  function fitName(key, f) {
    var next = nextSkillOf(f);
    if (next && next.key === key) return next.comp.name;
    var row = (SKILLS[f.family] || []).find(function (r) {
      return r.key === key;
    });
    if (row) return row.name;
    var h = HABITS.find(function (x) {
      return x.key === key;
    });
    return h ? h.name : '';
  }

  /* The support line in this student's comment: their own pick for this
     report, else the class's ticked line that fits them (supportFit). null
     when none is ticked, none fits, or the teacher left the sentence out
     for this student. { line, fit, mine }. */
  function supportChoice(f, habits) {
    var cl = (f && f.classLines) || {};
    var lines = cl.support || [];
    if (cl.pick === 'none') return null;
    var mine = cl.pick
      ? lines.find(function (l) {
          return l.id === cl.pick;
        })
      : null;
    if (mine) return { line: mine, fit: supportFit(mine, f, habits), mine: true };
    if (!lines.length) return null;
    var fitted = lines
      .map(function (l) {
        return { line: l, fit: supportFit(l, f, habits) };
      })
      .filter(function (x) {
        return x.fit;
      });
    var next = nextSkillOf(f);
    var bySkill = fitted.find(function (x) {
      return next && x.fit === next.key;
    });
    // No ticked line fits this student: the sentence is left out (the
    // Support row shows "Choose…"), never the first ticked line.
    var pick = bySkill || fitted[0] || null;
    return pick ? { line: pick.line, fit: pick.fit, mine: false } : null;
  }

  /* The claims a gate decides, and whether a sentence passes them for this
     context: a sentence claiming one below its gate is not eligible. A
     context built by hand, without facts, has nothing to gate. */
  var GATED = ['strength', 'improved', 'evenResults'];
  function passesGates(s, ctx) {
    var f = ctx && ctx._f;
    if (!f || !ctx._facts) return true;
    var cs = (s.claims || []).filter(function (c) {
      return GATED.indexOf(c) >= 0;
    });
    if (!cs.length) return true;
    var pv = provenance(s, ctx);
    return cs.every(function (c) {
      return CLAIMS[c](pv, f, ctx);
    });
  }

  /* Every value a bank sentence can ask for, from the facts and the
     teacher's picks { habits, focus, ican }. An empty value means the
     sentences that need it are not offered. */
  function context(f, picks) {
    picks = picks || {};
    var p = f.pronouns;
    var habits = effectiveHabits(picks.habits || f.habits, f.record, f);
    var withLevels = f.comps.filter(function (c) {
      return c.start > 0 && c.now > 0;
    });

    // The picture of the term (pictureOf), what rose and what fell.
    var nowWords = withLevels.map(function (c) {
      return word(c.now);
    });
    // What rose: only competencies past the "improved" gate (improvedComp),
    // the biggest change first.
    var rises = f.comps.filter(improvedComp).sort(function (a, b) {
      return trendOf(b.scores) - trendOf(a.scores);
    });
    var drops = withLevels.filter(function (c) {
      return tenths(c.now) < tenths(c.start);
    });
    var picture = pictureOf(f.comps);
    var fell = withLevels.filter(function (c) {
      return word(c.start) === 'Extending' && word(c.now) === 'Proficient';
    });

    var options = focusOptions(f, picks.focus);
    var focus =
      options.find(function (c) {
        return c.id === picks.focus;
      }) || options[0];
    var iCan =
      focus && focus.iCans.length ? _ended(focus.iCans[Math.min(picks.ican || 0, focus.iCans.length - 1)]) : '';
    // Strengths pass the "strongest" gate (strongestOf); the areas to grow
    // are the two lowest (only below the highest, so an even term names none).
    var byNow = f.comps.slice().sort(function (a, b) {
      return b.level - a.level;
    });
    var highest = byNow.length ? tenths(byNow[0].level) : 0;
    var lowest = byNow
      .slice()
      .reverse()
      .filter(function (c) {
        return tenths(c.level) < highest;
      })
      .slice(0, 2);
    var strongest = strongestOf(f.comps);
    // The strengths as skills (plan part 3), never the bare labels.
    var strongSkills = strengthSkills(f);
    // Where the student is now in the first strength (Colin, 2026-11-02):
    // the bank's phrase with the Ministry qualifier for its level word, for
    // a competency from the BC bank (strengthNowOf).
    var nowSk = strengthNowOf(f);
    // Progress in levels over the term, for a bank competency (progressOf).
    var prog = progressOf(f);
    // Even results (evenComps): no strongest, every judged competency
    // within half a step; the first two as skills, for the n5xx frames.
    var evenNow = evenComps(f.comps, f.overall);
    var evenSk = evenSkills(f);
    // The strength as one skill (topSkillOf): the strongest, else one of a
    // tie at the top (topTieOf), for the frames under `when.topSkill`.
    var topSk = topSkillOf(f);
    // The student's own highest-marked skill (highestSkills), when no
    // other route names a strength, for the frames under `when.highestWord`.
    var hiSk = highestSkills(f);
    var hiTop = highestIsTop(f, hiSk[0]);
    var levelled = f.comps.filter(function (c) {
      return c.level > 0;
    });
    var fallen = drops.length
      ? drops.slice().sort(function (a, b) {
          return tenths(a.start) - tenths(a.now) - (tenths(b.start) - tenths(b.now));
        })[0]
      : null;

    // Work: best and lowest this term. The best piece follows the one rule
    // At a Glance reads too (bestOrderOf).
    var best = bestOrderOf(f);
    var low = f.work.slice().sort(function (a, b) {
      return a.v - b.v || b.d.localeCompare(a.d);
    });
    var top = best[0];
    // The skill the best piece shows, said when it has no note
    // (bestPieceSkillOf).
    var topPieceSkill = top ? bestPieceSkillOf(f, top) : null;
    var topSkillText = topPieceSkill ? topPieceSkill.skill : '';
    var weak = low[0] && top && tenths(low[0].v) < tenths(top.v) ? low[0] : null;
    // Titles in quotes, the lesson number dropped (the realiser's rule).
    var the = function (w) {
      return R.quoteTitle(w.title);
    };
    var weakTwo = low.filter(function (w) {
      return top && tenths(w.v) < tenths(top.v);
    });

    // The Focus Area's work, for the family to see and ask about (the Ways
    // to Support at Home block's rule).
    var seeWork = '';
    var aboutWork = '';
    var seeId = null;
    var aboutId = null;
    if (focus) {
      var fw = {};
      focus.scores.forEach(function (s) {
        if (!fw[s.title] || s.v > fw[s.title].v) fw[s.title] = s;
      });
      var fl = Object.keys(fw).map(function (k) {
        return fw[k];
      });
      if (fl.length > 1) {
        var fb = fl.slice().sort(function (a, b) {
          return b.v - a.v || b.d.localeCompare(a.d);
        })[0];
        var fo = fl.slice().sort(function (a, b) {
          return a.v - b.v || b.d.localeCompare(a.d);
        })[0];
        if (fb !== fo) {
          seeWork = fb.title;
          aboutWork = fo.title;
          seeId = fb.id;
          aboutId = fo.id;
        }
      }
    }

    // The habits sentence (habitSummary): the one or two to build, or all
    // excellent, or good; on the IE path, the habits rated Consistently.
    var hsum = habitSummary(habits);
    var hword = function (k, form) {
      return habitWords(k, form, f.family || '', p);
    };
    var buildWords = hsum.build.map(function (k) {
      return hword(k, 'build');
    });
    var strongThree = hsum.strong.slice(0, 3);
    var conf = f.confidence;
    var selfStrong = conf.length > 1 && conf[0].c >= 3 ? conf[0] : null;
    var selfLow = conf.length > 1 && conf[conf.length - 1].c <= 2 ? conf[conf.length - 1] : null;

    // The facts behind each slot, for the draft's provenance and verify():
    // 'comp:<section id>', 'work:<assessment id>',
    // 'habit:<key>', 'confidence:<section id>', or a field of the facts.
    var keys = function (kind, xs) {
      return xs.filter(Boolean).map(function (x) {
        return kind + ':' + (x.id != null ? x.id : x);
      });
    };
    var habitKeys = function (ks) {
      return keys('habit', ks);
    };
    var focusKeys = keys('comp', [focus]);
    // The next step as a skill, and the class's lines (plan PR 8).
    var next = nextSkillOf(f);
    // The next step at the student's level, for a bank competency (levelStepOf).
    var lstep = levelStepOf(f);
    var support = supportChoice(f, habits);
    var goal = languageGoalChoice(f);
    var lines = f.classLines || {};
    var gr = gradeOf(f);
    var gslots = gradeSlots(gr);
    // The story's facts (angleFacts) as slots a sentence can need without
    // printing them (bank expansion, Nov 1): the marks climbed over the
    // term, strong in one skill and a full proficiency lower in another,
    // strong submitted work behind work labelled Missing, and joined the
    // class late. Each is 'yes' or '', so the sentences bound to a story
    // are offered only while it holds, and verify() re-reads them.
    var af = angleFacts(f, picks);
    var hiddenNow = af.missing >= 2 && af.missing * 5 >= af.total && af.strongWork;
    var factsOf = {
      climb: ['grade.pieces'],
      split: keys('comp', f.comps),
      hidden: ['notHandedIn', 'work'],
      newcomer: ['enrolled'],
      bestNote: keys('work', [top]),
      gradeLetter: ['grade.letter'],
      gradeStanding: ['grade.letter'],
      gradeNext: ['grade.pct', 'grade.pieces'],
      gradeWord: ['overall'],
      missingWork: ['notHandedIn'],
      markedMine: ['grade.marked'],
      markedClass: ['grade.marked'],
      ieDeadline: ['grade.ieDeadline'],
      standing: ['overall'],
      letterStanding: ['letter'],
      evidence: ['overall', 'work'],
      strengths: keys(
        'comp',
        strongSkills.map(function (x) {
          return x.comp;
        }),
      ),
      strength: keys('comp', [strongSkills[0] && strongSkills[0].comp]),
      // The strongest skill's key (`when.strongSkill`, the per-skill
      // strengths frames): the competency behind the first strength.
      strongSkill: keys('comp', [strongSkills[0] && strongSkills[0].comp]),
      // The first strength at its level now (`when.strengthWord`).
      strengthNow: keys('comp', [nowSk && nowSk.comp]),
      progressFrom: keys('comp', [prog && prog.comp]),
      progressTo: keys('comp', [prog && prog.comp]),
      progressSkill: keys('comp', [prog && prog.comp]),
      // The strength as one skill (`when.topSkill`): the strongest, or one
      // of a tie at the top.
      topSkill: keys('comp', [topSk && topSk.comp]),
      // Even results (evenComps): every competency the claim rests on, the
      // one named as a skill, and the proficiency word the frame is for.
      evenResults: keys('comp', evenNow),
      evenSkill: keys('comp', [evenSk[0] && evenSk[0].comp]),
      evenWord: ['overall'].concat(keys('comp', evenNow)),
      // The highest-marked skill (highestSkills): the competency named;
      // "highest" over every competency with a level rests on them all.
      highestSkill: keys('comp', [hiSk[0] && hiSk[0].comp]),
      highestTop: keys('comp', levelled),
      growthAreas: keys('comp', lowest),
      even: keys('comp', withLevels),
      rise: keys('comp', [rises[0]]),
      fall: keys('comp', [fallen]),
      fellCount: keys('comp', fell),
      assignment: keys('work', [top]),
      level: keys('work', [top]),
      bestPiece: keys('work', [top]).concat(keys('comp', [topPieceSkill && topPieceSkill.comp])),
      assignment2: keys('work', [weak]),
      level2: keys('work', [weak]),
      strongWorks: keys('work', best.slice(0, 2)),
      weakWorks: keys('work', weakTwo.slice(0, 2)),
      selfGood: ['voice.good'],
      selfHard: ['voice.hard'],
      selfStrong: keys('confidence', [selfStrong]),
      selfLow: keys('confidence', [selfLow]),
      goal: ['voice.goal'],
      plan: ['voice.plan'],
      focus: focusKeys,
      focusLow: focusKeys,
      nextStep: focusKeys,
      nextSkill: keys('comp', [next && next.comp]),
      levelStep: keys('comp', [lstep && lstep.comp]),
      seeWork: focusKeys.concat(keys('work', [seeId])),
      aboutWork: focusKeys.concat(keys('work', [aboutId])),
      habitsExcellent: habitKeys(hsum.seen),
      habitsGood: habitKeys(hsum.seen),
      habitsAllSeen: habitKeys(hsum.seen),
      habitToBuild: habitKeys(hsum.build),
      habitsToBuild: habitKeys(hsum.build),
      habitStrengths: habitKeys(strongThree),
      strongHabits: habitKeys(strongThree),
      attendance: ['attendance.absent', 'attendance.late'],
      // The attendance frames (bank h61-h78): the classes missed, the times
      // late, and whether only one of the two is entered.
      absentClasses: ['attendance.absent'],
      lateTimes: ['attendance.late'],
      absentOnly: ['attendance.absent', 'attendance.late'],
      lateOnly: ['attendance.absent', 'attendance.late'],
      // The Not Handed In frames (bank m02-m21).
      missingTitle: ['notHandedIn'],
      missingTitles: ['notHandedIn'],
      missingMany: ['notHandedIn'],
      missingGroup: ['notHandedIn'],
      // The counts and the proficiency word a teacher's own sentence can
      // hold as slots (plan PR 10, teacher/comment-personal.js).
      missingCount: ['notHandedIn'],
      absentCount: ['attendance.absent'],
      standingWord: ['overall'],
    };
    // The competency names behind each competency slot, for a teacher's own
    // sentence bound to one ("Offered when Evidence is a strength").
    var names = function (xs) {
      return xs.filter(Boolean).map(function (c) {
        return c.name;
      });
    };
    var compNames = {
      strengths: names(strongest),
      strongSkill: names([strongSkills[0] && strongSkills[0].comp]),
      strengthNow: names([nowSk && nowSk.comp]),
      progressFrom: names([prog && prog.comp]),
      progressTo: names([prog && prog.comp]),
      progressSkill: names([prog && prog.comp]),
      topSkill: names([topSk && topSk.comp]),
      evenSkill: names([evenSk[0] && evenSk[0].comp]),
      highestSkill: names([hiSk[0] && hiSk[0].comp]),
      growthAreas: names(lowest),
      rise: names([rises[0]]),
      fall: names([fallen]),
      focus: names([focus]),
      focusLow: names(
        focus &&
          lowest.some(function (c) {
            return c.id === focus.id;
          })
          ? [focus]
          : [],
      ),
      nextStep: names([focus]),
      nextSkill: names([next && next.comp]),
      levelStep: names([lstep && lstep.comp]),
    };
    var missingN = _missingCount(f);
    var absentN = Math.floor(Number(f.absent)) || 0;
    var att = attendanceSlots(f.absent, f.late);
    var ms = missingN > 0 ? missingSlots(f.notHandedIn) : { title: '', titles: '', many: '', group: '' };

    return {
      // The facts and picks this context was built from, so draft() can
      // pick the story (angle) and verify the draft before returning it.
      _f: f,
      _picks: picks,
      _p: p,
      _habits: habits,
      // The teacher's own ratings, without Completes Work from the record.
      _rated: effectiveHabits(picks.habits || f.habits, null),
      _standing: f.standing || '',
      _family: f.family || '',
      _grade: gr ? gr.kind : '',
      _ieProblem: ieProblemOf(f),
      _path: reportPath(f),
      // The next step's skill key (SKILLS), for the frames written for one
      // skill (`when.nextSkill`); '' when there is no next step.
      _nextSkill: next ? next.key : '',
      // The strongest skill's key (SKILLS), for the per-skill strengths
      // frames (`when.strongSkill`); '' below the "strongest" gate.
      _strongSkill: strongSkills[0] ? strongSkills[0].key : '',
      // The first strength's level word, for `when.strengthWord`.
      _strengthWord: nowSk ? nowSk.word : '',
      // The strength's skill key for the frames that claim a strength, not
      // the strongest (`when.topSkill`): the strongest skill, else one of a
      // tie at the top (topSkillOf); '' with neither.
      _topSkill: topSk ? topSk.key : '',
      // The overall proficiency word while the results are even
      // (`when.evenWord`), in every grading style: a condition only, so a
      // Letter class binds the verb to it without printing it.
      _evenWord: evenNow.length && f.overall > 0 ? word(f.overall) : '',
      // The even skills in the order they are offered (evenSkills): the
      // first fills {evenSkill}; a frame too long with it takes the next
      // that fits (ctxFor).
      _evenSkills: evenSk,
      // The highest-marked skill's key and its own proficiency word
      // (`when.highestSkill`, `when.highestWord`), and the candidates in
      // the order they are offered (highestSkills; ctxFor).
      _highestSkill: hiSk[0] ? hiSk[0].key : '',
      _highestWord: hiSk[0] ? hiSk[0].word : '',
      _highestSkills: hiSk,
      _options: options,
      _focus: focus || null,
      _facts: factsOf,
      _compNames: compNames,
      _bestNote: !!(top && reportNoteText(top.note)),
      // Who the comment is about, and the slots built as whole sentences
      // about them, as tokens: the realiser names the student in the first
      // sentence that mentions them (plan PR 9).
      _who: _whoOfFacts(f),
      // The one habit rated Sometimes or Rarely, when exactly one is: the
      // habit a Habit Ratings frame may be drafted for (habitCellFits).
      _habitAlone: hsum.build.length === 1 ? hsum.build[0] : '',
      _toks: {
        bestPiece: top ? bestPieceTokens({ title: top.title, note: top.note, skill: topSkillText }) : null,
        habitStrengths: hsum.excellent ? null : strengthsTokens(f, strongThree),
        strongHabits: hsum.excellent ? null : strongHabitsTokens(f, strongThree),
      },
      name: f.name,
      course: f.course,
      picture: picture,
      standing: f.standing ? aOrAn(f.standing) + ' level' : '',
      letterStanding: f.letter,
      gradeLetter: gslots.gradeLetter,
      gradeStanding: gslots.gradeStanding,
      gradeNext: gslots.gradeNext,
      gradeWord: gslots.gradeWord,
      // The IE path: the work not handed in as one sentence, the marks
      // against the class's, and the deadline ('' until it is picked, so
      // no Deadline frame fits and none is drafted).
      // The work not handed in as one sentence: the IE path's problem, and
      // the Not Handed In sentence on the others.
      missingWork: _missingCount(f) > 0 ? notHandedInSentence(f.notHandedIn) : '',
      markedMine: ieProblemOf(f) === 'marks' ? numberIn(f.grade.marked.mine) : '',
      markedClass: /^(marks|noMarks)$/.test(ieProblemOf(f)) ? numberIn(f.grade.marked.all) : '',
      ieDeadline: reportPath(f) === 'ie' ? _deadlineOf(f) : '',
      // One or two skills in plain words from the table, as the next step
      // is: "{He} can {strengths}." Never a bare competency label.
      strengths: strengthsText(f),
      strength: strengthText(f),
      // The strongest skill's key, needed and never printed: the frames
      // written for one skill say it in their own words.
      strongSkill: strongSkills[0] ? strongSkills[0].key : '',
      // The first strength in the bank's phrase, said at its level by the
      // frame (`when.strengthWord`): "{He} can consistently {strengthNow}."
      strengthNow: nowSk ? nowSk.skill : '',
      // "{He} rose from {progressFrom} to {progressTo} in {his} ability to {progressSkill}."
      progressFrom: prog ? prog.from : '',
      progressTo: prog ? prog.to : '',
      progressSkill: prog ? prog.skill : '',
      topSkill: topSk ? topSk.key : '',
      // Even results (evenComps): 'yes' while they hold; the highest even
      // competency as a skill; and the proficiency word as the class shows
      // it (f.standing: '' in a Letter class, so no frame prints it there).
      evenResults: evenNow.length ? 'yes' : '',
      evenSkill: evenSkillText(f),
      evenWord: evenNow.length ? f.standing || '' : '',
      // The highest-marked skill in the table's words, and 'yes' when no
      // competency with a level sits above it (the frames that say
      // "where {his} marks are highest" need it).
      highestSkill: hiSk[0] ? hiSk[0].skill : '',
      highestTop: hiTop ? 'yes' : '',
      growthAreas: list(
        lowest.map(function (c) {
          return c.name;
        }),
      ),
      even:
        withLevels.length > 1 &&
        nowWords.every(function (w) {
          return w === nowWords[0];
        })
          ? 'yes'
          : '',
      rise: rises.length ? rises[0].name : '',
      fall: fallen ? fallen.name : '',
      fellCount: fell.length > 1 ? NUM[fell.length] || String(fell.length) : '',
      assignment: top ? top.title : '',
      level: top ? workMark(f, top) : '',
      // The teacher's Note for the Report on the best piece, as a slot
      // after "where {he}": the best-piece frames with a note need it.
      bestNote: top ? noteSlot(top.note) : '',
      climb: af.climb ? 'yes' : '',
      split: af.split ? 'yes' : '',
      hidden: hiddenNow ? 'yes' : '',
      newcomer: af.joinedLate ? 'yes' : '',
      // The whole best-piece sentence, with the teacher's note when there is one.
      bestPiece: top
        ? bestPieceSentence({
            title: top.title,
            note: top.note,
            skill: topSkillText,
            name: f.name,
            pronouns: p,
            onFile: f.pronounsOnFile,
          })
        : '',
      assignment2: weak ? weak.title : '',
      level2: weak ? workMark(f, weak) : '',
      strongWorks: list(best.slice(0, 2).map(the)),
      weakWorks: list(weakTwo.slice(0, 2).map(the)),
      evidence: evidenceOf(f),
      selfGood: _quote(f.voice.good),
      selfHard: _quote(f.voice.hard),
      selfStrong: selfStrong ? selfStrong.name : '',
      selfLow: selfLow ? selfLow.name : '',
      goal: _quote(f.voice.goal),
      plan: _quote(f.voice.plan),
      focus: focus ? focus.name : '',
      // The Focus Area only when it is one of the two lowest now, for
      // sentences that call it the area to build (the report's Focus Area
      // can be the biggest change, rising or falling).
      focusLow:
        focus &&
        lowest.some(function (c) {
          return c.id === focus.id;
        })
          ? focus.name
          : '',
      nextStep: iCan,
      // One skill in plain words for the next step, never the bare label.
      nextSkill: next ? next.skill : '',
      // The next step toward the level above, from the bank (levelStepOf).
      levelStep: lstep ? lstep.text : '',
      // The teacher's own text, exactly as typed: the support line for this
      // student, the class's closing sentence and its late-work line.
      supportLine: support ? support.line.text : '',
      // The Language Goals line the teacher picked for this student (a
      // template, filled like a bank sentence), on that path only.
      languageGoalLine: goal ? goal.line.text : '',
      closingLine: lines.closing || '',
      lateLine: lines.late || '',
      seeWork: seeWork,
      aboutWork: aboutWork,
      habitsExcellent: hsum.excellent ? 'yes' : '',
      habitsGood: hsum.good ? 'yes' : '',
      // All six habits carry a rating (none Not Seen): the frames that say
      // "all six" or "every one" need it (review of #595).
      habitsAllSeen: hsum.seen.length === HABITS.length ? 'yes' : '',
      habitToBuild: buildWords.length === 1 ? buildWords[0] : '',
      habitsToBuild: buildWords.length === 2 ? list(buildWords) : '',
      habitStrengths: hsum.excellent ? '' : strengthsSentence(f, strongThree),
      strongHabits: hsum.excellent ? '' : strongHabitsPhrase(f, strongThree),
      // "missed three classes and been late once", either half left out
      // when its field is empty or zero (plan, Sentence grammar).
      attendance: attendanceText(f.absent, f.late),
      // The same counts as slots: "three classes", "once"; absentOnly and
      // lateOnly ('yes') when the other count is empty or zero.
      absentClasses: att.absentClasses,
      lateTimes: att.lateTimes,
      absentOnly: att.absentOnly,
      lateOnly: att.lateOnly,
      // The work not handed in as slots: the one title, the two titles,
      // the count of three or more with no group, and the group.
      missingTitle: ms.title,
      missingTitles: ms.titles,
      missingMany: ms.many,
      missingGroup: ms.group,
      // How many pieces are labelled Missing, and classes missed, as numbers
      // (the realiser spells them by place), and the overall proficiency
      // word: slots for a teacher's own sentences (plan PR 10).
      missingCount: missingN > 0 ? String(missingN) : '',
      absentCount: absentN > 0 ? String(absentN) : '',
      standingWord: f.standing || '',
    };
  }

  /* What the attendance sentence says after "{He} has": "missed three
     classes and been late once"; "missed 12 classes"; "been late twice".
     '' when neither field has a count. */
  function attendanceText(absent, late) {
    var a = Math.floor(Number(absent)) || 0;
    var l = Math.floor(Number(late)) || 0;
    var bits = [];
    if (a > 0) bits.push('missed ' + numberIn(a) + (a === 1 ? ' class' : ' classes'));
    if (l > 0) bits.push('been late ' + R.times(l));
    return bits.join(' and ');
  }
  /* The same counts as slots for the attendance frames (bank h61-h78):
     absentClasses "three classes" ("one class"), lateTimes "once" /
     "twice" / "three times", each '' at zero or empty; absentOnly and
     lateOnly 'yes' when the other count is zero or empty. */
  function attendanceSlots(absent, late) {
    var a = Math.floor(Number(absent)) || 0;
    var l = Math.floor(Number(late)) || 0;
    return {
      absentClasses: a > 0 ? numberIn(a) + (a === 1 ? ' class' : ' classes') : '',
      lateTimes: l > 0 ? R.times(l) : '',
      absentOnly: a > 0 && !l ? 'yes' : '',
      lateOnly: l > 0 && !a ? 'yes' : '',
    };
  }

  /* ── Offering and filling ──────────────────────────────────────────── */

  /* A sentence for some kinds of class (`subjects`), or for all but some
     (`except`); without either, for every class. */
  function forFamily(s, family) {
    if (s.subjects && s.subjects.indexOf(family) < 0) return false;
    if (s.except && family && s.except.indexOf(family) >= 0) return false;
    return true;
  }

  /* A sentence fits when its class, slots and conditions match and every
     gated claim it makes passes its evidence gate (passesGates). */
  function fits(s, ctx) {
    return _fitsSlots(s, ctx) && passesGates(s, ctx);
  }
  /* opts.story === false: the story slots (STORY_SLOTS) are not required.
     verify() reads a sentence that way: a story is a condition for
     offering it, and what the sentence asserts about the story is a claim
     (improved, split, newcomer), so an approved sentence is not flagged
     when the story changes but its words still hold. */
  function _fitsSlots(s, ctx, opts) {
    if (!forFamily(s, ctx._family || '')) return false;
    var needs = s.needs || [];
    var story = !(opts && opts.story === false);
    for (var i = 0; i < needs.length; i++) {
      if (!story && STORY_SLOTS.indexOf(needs[i]) >= 0) continue;
      if (!ctx[needs[i]]) return false;
    }
    if (!_fitsMine(s, ctx)) return false;
    var when = s.when || {};
    return Object.keys(when).every(function (k) {
      if (k === 'picture') return ctx.picture === when[k];
      if (k === 'standing') return ctx._standing === when[k];
      if (k === 'grade') return ctx._grade === when[k];
      if (k === 'path') return ctx._path === when[k];
      if (k === 'ieProblem') return ctx._ieProblem === when[k];
      if (k === 'nextSkill') return !!ctx._nextSkill && ctx._nextSkill === when[k];
      if (k === 'strongSkill') return !!ctx._strongSkill && ctx._strongSkill === when[k];
      if (k === 'topSkill') return !!ctx._topSkill && ctx._topSkill === when[k];
      if (k === 'evenWord') return !!ctx._evenWord && ctx._evenWord === when[k];
      if (k === 'highestSkill') return !!ctx._highestSkill && ctx._highestSkill === when[k];
      if (k === 'highestWord') return !!ctx._highestWord && ctx._highestWord === when[k];
      if (k === 'strengthWord') return !!ctx._strengthWord && ctx._strengthWord === when[k];
      return (ctx._habits || {})[k] === when[k];
    });
  }

  /* A teacher's own sentence (plan PR 10) holds only where it was written:
     `comps` names the competencies it was about, per slot (any one of them
     there now, as in "Offered when Evidence is a strength"), and `counts`
     whether a count was one or more, so "One assignment is" never reads
     "Three assignment is". Shared bank sentences have neither. */
  function _fitsMine(s, ctx) {
    var comps = s.comps || {};
    var ok = Object.keys(comps).every(function (k) {
      var have = ((ctx._compNames || {})[k] || []).map(function (n) {
        return String(n).toLowerCase();
      });
      return (comps[k] || []).some(function (n) {
        return have.indexOf(String(n).toLowerCase()) >= 0;
      });
    });
    if (!ok) return false;
    var counts = s.counts || {};
    return Object.keys(counts).every(function (k) {
      var n = Number(ctx[k]) || 0;
      return counts[k] === 'one' ? n === 1 : n > 1;
    });
  }

  /* A bank sentence as the realiser's tokens (CommentRealiser.tokens):
     the student in each role, a data slot's value as written (a note or a
     student's answer that holds "{name}" or "[a|b]" is never read as a
     slot), a [singular|plural] verb, and the slots built whole (the best
     piece, the strong habits) as their own tokens. */
  function _tokensRaw(s, ctx) {
    var own = Object.prototype.hasOwnProperty;
    var toks = ctx._toks || {};
    return R.tokens(s.text, function (k) {
      if (own.call(toks, k) && toks[k] && own.call(ctx, k) && ctx[k]) return toks[k];
      return own.call(ctx, k) && ctx[k] != null ? String(ctx[k]) : '';
    });
  }
  function sentenceTokens(s, ctx) {
    return _tokensRaw(s, ctxFor(s, ctx));
  }

  /* The context one sentence is filled from (the realiser's length rule,
     2026-11-01: the realised sentence counts, not the template). When
     "{strengths}" holds two skills and the sentence filled with both runs
     past 20 words, the slot holds the strongest skill alone ({strength}),
     and the provenance records that value. A sentence still over 20 words
     with one skill is not offered (_compose) and fails verify(). */
  function ctxFor(s, ctx) {
    if (!s || !ctx) return ctx;
    var text = String(s.text || '');
    if (/\{evenSkill\}/.test(text)) return _evenCtxFor(s, ctx);
    if (/\{highestSkill\}/.test(text)) return _highestCtxFor(s, ctx);
    if (!/\{strengths\}/.test(text)) return ctx;
    if (!ctx.strengths || !ctx.strength || ctx.strengths === ctx.strength) return ctx;
    if (!R.tooLong(R.render(_tokensRaw(s, ctx), whoOf(ctx), { named: true }))) return ctx;
    return Object.assign({}, ctx, { strengths: ctx.strength });
  }
  /* The same for "{evenSkill}": a frame that runs past 20 words with the
     first even skill (evenSkills, the least named in the class) holds the
     next even skill that keeps it within 20, with the facts and
     competency name behind the slot moved with it, so the provenance and
     verify() read the competency actually named. */
  function _evenCtxFor(s, ctx) {
    var xs = ctx._evenSkills || [];
    if (!ctx.evenSkill || xs.length < 2) return ctx;
    var long = function (c) {
      return R.tooLong(R.render(_tokensRaw(s, c), whoOf(c), { named: true }));
    };
    if (!long(ctx)) return ctx;
    for (var i = 1; i < xs.length; i++) {
      var alt = Object.assign({}, ctx, {
        evenSkill: xs[i].skill,
        _facts: Object.assign({}, ctx._facts, { evenSkill: ['comp:' + xs[i].comp.id] }),
        _compNames: Object.assign({}, ctx._compNames, { evenSkill: [xs[i].comp.name] }),
      });
      if (!long(alt)) return alt;
    }
    return ctx;
  }
  /* The same for "{highestSkill}": a frame that runs past 20 words with
     the first highest-marked skill (highestSkills) holds the next one with
     the same proficiency word that keeps it within 20, its facts, key and
     word moved with it. */
  function _highestCtxFor(s, ctx) {
    var xs = ctx._highestSkills || [];
    if (!ctx.highestSkill || xs.length < 2) return ctx;
    var long = function (c) {
      return R.tooLong(R.render(_tokensRaw(s, c), whoOf(c), { named: true }));
    };
    if (!long(ctx)) return ctx;
    for (var i = 1; i < xs.length; i++) {
      if (xs[i].word !== ctx._highestWord) continue;
      var alt = _withHighest(ctx, xs[i]);
      if (!long(alt)) return alt;
    }
    return ctx;
  }
  /* A context with another of the highest-marked skills in the slot. */
  function _withHighest(ctx, x) {
    return Object.assign({}, ctx, {
      highestSkill: x.skill,
      _highestSkill: x.key,
      _highestWord: x.word,
      _facts: Object.assign({}, ctx._facts, { highestSkill: ['comp:' + x.comp.id] }),
      _compNames: Object.assign({}, ctx._compNames, { highestSkill: [x.comp.name] }),
    });
  }
  /* Who a context is about: { name, p, onFile }. A context built by hand
     with pronouns counts them as on file. */
  function whoOf(ctx) {
    if (ctx._who) return ctx._who;
    return { name: ctx.name || '', p: ctx._p, onFile: !!ctx._p };
  }

  /* One sentence filled for the student where a sentence usually sits,
     after the first: their pronouns, they/them when none are on file. A draft
     puts each sentence in its place with realise(), which names the
     student in the first sentence that mentions them. opts.first: fill it
     as the comment's first sentence, naming the student. */
  function fill(s, ctx, opts) {
    return R.render(sentenceTokens(s, ctx), whoOf(ctx), { named: !(opts && opts.first) });
  }

  /* A comment's sentences put in order and filled for their places (the
     realiser, plan PR 9): the student named in the first sentence that
     mentions them, pronouns after; teacher text as typed. order: positions
     or sentence ids; the screen calls this when the teacher moves a
     sentence. Returns { text, sentences }. */
  function realise(sentences, order) {
    return R.realise(sentences, order);
  }
  /* A draft with its sentences realised in their order. */
  function _realised(d) {
    var r = R.realise(d.sentences);
    return Object.assign({}, d, {
      text: r.text,
      sentences: r.sentences,
      ids: r.sentences.map(function (x) {
        return x.id;
      }),
    });
  }

  /* A sentence as a pattern with its slots as wildcards, to find it in a
     classmate's comment. A sentence that is mostly slots ("{name}
     {strengthHabits}.") would match any comment, so one with fewer than
     four words of its own has none. Cached by id and wording, with the
     wording's own pieces (_literals), which a comment must hold before the
     pattern is tried: a pattern with several wildcards is slow on a long
     comment that does not hold it. */
  var _patterns = {};
  var _literals = {};
  function pattern(s) {
    var key = s.id + '\u0000' + s.text;
    if (key in _patterns) return _patterns[key];
    var fixed = String(s.text)
      .replace(/\{\w+\}/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .split(/\s+/)
      .filter(function (w) {
        return /[a-z]{2}/i.test(w);
      });
    var re = null;
    var lits = [];
    if (fixed.length >= 4) {
      var src = String(s.text)
        .split(/(\{\w+\}|\[[^\]]*\])/)
        .map(function (part) {
          if (/^\{\w+\}$/.test(part)) return '.+?';
          var alt = part.match(/^\[([^|\]]*)\|([^\]]*)\]$/);
          if (alt) return '(?:' + alt[1] + '|' + alt[2] + ')';
          var lit = part.trim().toLowerCase();
          if (lit.length >= 3) lits.push(lit);
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('');
      re = new RegExp(src, 'i');
    }
    _patterns[key] = re;
    _literals[key] = lits;
    return re;
  }

  /* Whether a comment holds the sentence: its pattern found in the text.
     lower: the text in lower case, for the quick check of its pieces. */
  function _holds(s, text, lower) {
    var re = pattern(s);
    if (!re) return false;
    var lits = _literals[s.id + '\u0000' + s.text];
    for (var i = 0; i < lits.length; i++) if (lower.indexOf(lits[i]) < 0) return false;
    return re.test(text);
  }

  /* A classmate's comment as { sid, text }: the screen passes { sid, text };
     a plain string has no sid. */
  function _comment(c) {
    if (c && typeof c === 'object') return { sid: c.sid != null ? String(c.sid) : null, text: String(c.text || '') };
    return { sid: null, text: String(c == null ? '' : c) };
  }

  /* The values a bank sentence was filled with, read back from a sentence
     of a saved comment (the rows recovered after a reload): each slot as
     the text has it, when the whole sentence is that bank sentence's
     wording with its slots filled; null otherwise. A wording of fewer than
     four words of its own holds too many sentences to read back (pattern),
     except the Not Handed In sentence, whose wording is the app's own.
     Pronouns are not slots; a value is read as written, so a sentence whose
     values changed since fails verify(). */
  var READ_SHAPES = {
    missingWork: /^(?:One assignment is|[A-Z][a-z]+(?:-[a-z]+)? assignments are) not handed in[:,.]/,
  };
  function _reEsc(t) {
    return String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  var _anchored = {};
  function valuesIn(s, text) {
    var t = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    var src = String((s && s.text) || '');
    var whole = src.match(/^\{(\w+)\}$/);
    if (whole) {
      var shape = READ_SHAPES[whole[1]];
      if (!shape || !shape.test(t)) return null;
      var one = {};
      one[whole[1]] = t;
      return one;
    }
    // The quick check first: the wording's own pieces are in the text.
    if (!_holds(s, t, t.toLowerCase())) return null;
    var key = s.id + '\u0000' + src;
    var a = _anchored[key];
    if (!a) {
      var keys = [];
      var re = new RegExp(
        '^' +
          src
            .split(/(\{\w+\}|\[[^\]]*\])/)
            .map(function (part) {
              var m = part.match(/^\{(\w+)\}$/);
              if (m) {
                keys.push(m[1]);
                // A pronoun or the name is a word or two, never a run of
                // the teacher's own words.
                if (PRONOUN_SLOTS[m[1]]) return '([^\\s]+)';
                if (m[1] === 'name') return '([^\\s]+(?: [^\\s]+)?)';
                return '(.+?)';
              }
              var alt = part.match(/^\[([^|\]]*)\|([^\]]*)\]$/);
              if (alt) return '(?:' + _reEsc(alt[1]) + '|' + _reEsc(alt[2]) + ')';
              return _reEsc(part);
            })
            .join('') +
          '$',
        'i',
      );
      a = _anchored[key] = { re: re, keys: keys };
    }
    // A title that ends the sentence carries the period inside its closing
    // quote, or its own ? or ! in place of it (the realiser).
    var u = t.replace(/\.”$/, '”.').replace(/([?!])”$/, '$1”.');
    var hit = u.match(a.re) || (u !== t ? t.match(a.re) : null);
    if (!hit) return null;
    var out = {};
    a.keys.forEach(function (k, i) {
      if (PRONOUN_SLOTS[k] || k in out) return;
      out[k] = hit[i + 1];
    });
    return out;
  }

  /* How many classmates' comments this term hold the sentence. */
  function usedBy(s, comments) {
    var re = pattern(s);
    if (!re) return 0;
    return (comments || []).filter(function (c) {
      var t = _comment(c).text;
      return _holds(s, t, t.toLowerCase());
    }).length;
  }

  /* The first word of the comment's last sentence: what follows the last
     . ! ? or closing quote that has a space after it. (No lookbehind, which
     Safari before 16.4 cannot parse.) */
  function lastStart(text) {
    var t = String(text || '').trim();
    var re = /[.!?”]\s+(?=\S)/g;
    var from = 0;
    var m;
    while ((m = re.exec(t))) from = m.index + m[0].length;
    return t.slice(from).split(/\s+/)[0] || '';
  }

  /* A row's note under its sentence. */
  function rowMeta(repeats, used) {
    var bits = [];
    if (repeats) bits.push('Starts like your last sentence');
    if (used >= USED_BY) bits.push('Used for ' + used + ' classmates this term');
    return bits.join(' · ');
  }
  /* Whether a sentence not yet added starts like the comment's last one. */
  function repeatsLast(sentence, last) {
    return !!last && String(sentence).split(/\s+/)[0] === last;
  }

  /* The Comment Bank column: the four parts in BC's order, each with the
     sentences that fit, grouped by source, two per group until Show All (an
     added sentence always shows), sentences used for three or more
     classmates last in their group. opts: { more: {part: true}, comments:
     classmates' comments this term, first: the first name for the titles
     (sentences use the name the student goes by), bank }. */
  function parts(ctx, text, opts) {
    opts = opts || {};
    var bank = opts.bank || COMMENT_BANK;
    var more = opts.more || {};
    var last = lastStart(text);
    var first = opts.first || ctx.name;
    var titles = {
      habits: 'Work Habits',
      now: 'Where ' + first + ' Is Now',
      go: 'Where ' + first + ' Needs to Go',
      how: 'How ' + first + ' Will Get There',
    };
    return bank.parts.map(function (part, i) {
      var all = bank.sentences.filter(function (s) {
        return s.part === part.id;
      });
      var ok = all.filter(function (s) {
        return fits(s, ctx);
      });
      var rows = ok.map(function (s, at) {
        var t = fill(s, ctx);
        var used = usedBy(s, opts.comments);
        return {
          id: s.id,
          group: s.group,
          text: t,
          added: String(text || '').indexOf(t) >= 0,
          used: used,
          crowded: used >= USED_BY,
          repeats: false,
          at: at,
        };
      });
      // Groups keep their bank order; inside a group, crowded sentences last.
      var groupAt = {};
      rows.forEach(function (r) {
        if (!(r.group in groupAt)) groupAt[r.group] = r.at;
      });
      rows.sort(function (a, b) {
        return groupAt[a.group] - groupAt[b.group] || a.crowded - b.crowded || a.at - b.at;
      });
      var seen = {};
      var shown = more[part.id]
        ? rows
        : rows.filter(function (r) {
            seen[r.group] = (seen[r.group] || 0) + 1;
            return seen[r.group] <= PER_GROUP || r.added;
          });
      var prev = '';
      shown.forEach(function (r) {
        r.first = r.group !== prev;
        prev = r.group;
        r.repeats = !r.added && repeatsLast(r.text, last);
        r.meta = rowMeta(r.repeats, r.used);
      });
      return {
        id: part.id,
        n: String(i + 1),
        title: titles[part.id] || part.title,
        rows: shown,
        fit: ok.length,
        total: all.length,
        waiting: all.length - ok.length,
        canMore: shown.length < rows.length || !!more[part.id],
        more: !!more[part.id],
        inComment: rows.some(function (r) {
          return r.added;
        }),
      };
    });
  }

  /* ── Generate ──────────────────────────────────────────────────────── */

  /* A small repeatable random: the same seed gives the same draft. */
  function _rng(seed) {
    var x = (Number(seed) || 1) >>> 0;
    return function () {
      x = (x + 0x6d2b79f5) >>> 0;
      var t = x;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedFor(text) {
    var h = 2166136261;
    String(text || '')
      .split('')
      .forEach(function (ch) {
        h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
      });
    return h || 1;
  }

  /* The draft's steps, the plan's eight parts and nothing else: the grade
     sentence (gradeOf; none for IE, F or no marks), the habits (one summary
     sentence, then attendance when entered, then the work not handed in
     and the late-work line), the best piece, the strengths (overall), the
     next step with the support line and one thing the family can do, and
     the closing sentence. Each step takes at most one sentence. A step that
     `says` a fact (the grade) keeps every later sentence claiming it out.
     The angle (angle()) sets which steps run and in what order; this is
     the order with no story to tell. */
  var DRAFT_STEPS = [
    { key: 'grade', part: 'now', groups: ['Grade'], says: 'grade' },
    // The summary sentence, or (habitCellFits) a Habit Ratings frame for
    // the one habit rated below Usually.
    { key: 'habits', part: 'habits', groups: ['Work Habits', 'Habit Ratings'] },
    { key: 'attendance', part: 'habits', groups: ['Attendance'] },
    // The work labelled Missing, then the class's late-work line after it
    // (plan PR 8): only for a student with work not handed in.
    { key: 'notHandedIn', part: 'habits', groups: ['Not Handed In'], says: 'notHandedIn' },
    { key: 'lateWork', part: 'habits', line: 'lateLine', after: 'notHandedIn' },
    // The strengths (plan part 3): one or two skills from the table.
    // The first strength at its level now, for a bank competency
    // (strengthNow), else one or two skills from the table; the teacher's
    // own sentences and the story's frames stay in (preferSoft).
    { key: 'overall', part: 'now', groups: ['Overall'], prefer: 'strengthNow', preferSoft: true },
    // The best piece (plan part 2): the one sentence of Examples From Work.
    { key: 'example', part: 'now', groups: ['Examples From Work'] },
    // The Language Goals line (plan PR 3b): a template the teacher picked,
    // filled for the student; empty off the language-goals path. Before the
    // Next Step sentence, never between it and its family line (#632).
    { key: 'languageGoals', part: 'go', line: 'languageGoalLine', template: true },
    // One skill from the table when there is one (`prefer`); never a
    // sentence that names a bare competency label (`never`).
    {
      key: 'nextStep',
      part: 'go',
      groups: ['Next Step'],
      // The bank's step at the student's level first, then the table's skill.
      prefer: ['levelStep', 'nextSkill'],
      never: ['focus', 'focusLow', 'growthAreas', 'rise', 'fall'],
    },
    // The teacher's support line for this student, one thing the family can
    // do at home, and the class's closing sentence (plan PR 8). Teacher
    // lines (`line`) are used exactly as typed and are left out when empty.
    { key: 'support', part: 'how', line: 'supportLine' },
    { key: 'home', part: 'how', groups: ['For the Family'] },
    { key: 'closer', part: 'how', line: 'closingLine' },
    // The IE path's Required parts (plan PR 3): only the IE story runs them.
    { key: 'ieProblem', part: 'now', groups: ['IE Problem'], ie: true },
    // The IE comment names the habits that are strong (the IE mockup).
    { key: 'strongHabits', part: 'habits', groups: ['Strong Habits'], ie: true },
    { key: 'iePlan', part: 'go', groups: ['IE Plan'], ie: true },
    { key: 'ieDeadline', part: 'go', groups: ['IE Deadline'], ie: true },
    { key: 'ieMeeting', part: 'how', groups: ['IE Meeting'], ie: true },
  ];

  /* The facts a step `says` once: no later sentence claims them again. */
  var SAYS = { grade: true, notHandedIn: true };

  /* Facts a draft states once, by topic. */
  var NO_REPEAT = { nextStep: 'nextStep' };

  /* A sentence that gives the student a next step: a Next Step sentence
     (the group the Next Step step draws from) or one flagged `advises:
     true`, which every sentence whose text says "next step" or "to do
     next" must carry (the lint test fails an undeclared one:
     CommentLint.advisesText). A For the Family sentence bound to the next
     step's skill (when.nextSkill) does not advise. A comment holds one
     such sentence, the Next Step step's (2026-11-01, the review of #603:
     a Habit Ratings frame was printed right before the Next Step sentence
     as a second next step). */
  function advises(s) {
    return !!s && (s.advises === true || s.group === 'Next Step');
  }

  /* The data slots a sentence names, in its own order: every {slot} but the
     pronouns, then any it needs without printing ("even"). */
  var PRONOUN_SLOTS = { He: 1, he: 1, him: 1, His: 1, his: 1, himself: 1 };
  function slotsOf(s) {
    var out = [];
    String(s.text).replace(/\{(\w+)\}/g, function (m, k) {
      if (!PRONOUN_SLOTS[k] && out.indexOf(k) < 0) out.push(k);
      return m;
    });
    (s.needs || []).forEach(function (k) {
      if (out.indexOf(k) < 0) out.push(k);
    });
    return out;
  }

  /* Where one sentence of a draft came from: its claims (from the bank), the
     facts behind it (factKeys, see context's _facts), and the values it was
     filled with ('when.<key>' for a `when` it matched). `sources` keeps the
     fact keys per slot, for verify(). */
  var CLAIM_FACTS = { lateWork: 'record.late', notHandedIn: 'notHandedIn' };
  function provenance(s, ctx) {
    var own = Object.prototype.hasOwnProperty;
    // The values as the sentence was filled: one skill in {strengths} when
    // two would run past 20 words (ctxFor).
    ctx = ctxFor(s, ctx);
    var values = {};
    var sources = {};
    var factKeys = [];
    var add = function (k) {
      if (factKeys.indexOf(k) < 0) factKeys.push(k);
    };
    slotsOf(s).forEach(function (k) {
      values[k] = own.call(ctx, k) && ctx[k] != null ? String(ctx[k]) : '';
      var fk = ctx._facts && own.call(ctx._facts, k) ? ctx._facts[k] : k === 'name' || k === 'course' ? [] : [k];
      sources[k] = fk.slice();
      fk.forEach(add);
    });
    var when = s.when || {};
    Object.keys(when).forEach(function (k) {
      values['when.' + k] = when[k];
      // A frame for one skill rests on the next step's competency, or on
      // the strongest one; an even-results frame on the even competencies
      // and the overall proficiency.
      if (k === 'nextSkill') return ((ctx._facts && ctx._facts.nextSkill) || []).forEach(add);
      if (k === 'strongSkill') return ((ctx._facts && ctx._facts.strongSkill) || []).forEach(add);
      if (k === 'strengthWord') return ((ctx._facts && ctx._facts.strengthNow) || []).forEach(add);
      if (k === 'topSkill') return ((ctx._facts && ctx._facts.topSkill) || []).forEach(add);
      if (k === 'evenWord') return ((ctx._facts && ctx._facts.evenWord) || []).forEach(add);
      if (k === 'highestSkill' || k === 'highestWord')
        return ((ctx._facts && ctx._facts.highestSkill) || []).forEach(add);
      add(
        k === 'picture'
          ? 'picture'
          : k === 'standing'
            ? 'overall'
            : k === 'grade' || k === 'ieProblem' || k === 'path'
              ? 'grade'
              : 'habit:' + k,
      );
    });
    (s.claims || []).forEach(function (c) {
      if (CLAIM_FACTS[c]) add(CLAIM_FACTS[c]);
    });
    return {
      sentenceId: s.id,
      part: s.part,
      claims: (s.claims || []).slice(),
      factKeys: factKeys,
      values: values,
      sources: sources,
    };
  }

  /* ── The angle: the story of this student's term ───────────────────── */

  /* Before any sentence is chosen, angle() picks the story the comment
     tells, from the facts alone. Each story sets which steps run, their
     order and which leads; the grade sentence always comes first. Only
     facts FullVision has: the scored pieces and their % (calc.js), the
     levels per competency, the work labelled Missing, the habit ratings
     (Completes Work from the record until rated), and the enrolment date.
     The lowest tier that holds wins; inside a tier, the story used least in
     the class, then this order. "Angle" is never shown. */
  var NEW_DAYS = 14; // joined two weeks or more after the class began
  var THIN = 3; // fewer scored pieces than this is too little to judge

  var ANGLES = [
    {
      // The mark is IE (calc.js, under 50% before the course ends, or the
      // teacher chose IE): the Required parts of the approved IE comment,
      // the problem, the habits that are strong, the plan, the deadline and
      // a chance to meet (plan PR 3).
      id: 'ie',
      tier: 1,
      when: function (a) {
        return a.ie;
      },
      order: ['ieProblem', 'strongHabits', 'iePlan', 'ieDeadline', 'ieMeeting'],
    },
    {
      // Too few scored pieces to say much: the habits and one example.
      id: 'thin',
      tier: 2,
      when: function (a) {
        return a.scored < THIN;
      },
      order: ['habits', 'attendance', 'example', 'nextStep', 'home', 'closer'],
    },
    {
      // Joined the class two weeks or more after it began, during this
      // term: no growth over a term that was not all theirs.
      id: 'newcomer',
      tier: 2,
      when: function (a) {
        return a.joinedLate;
      },
      order: ['habits', 'attendance', 'example', 'overall', 'nextStep', 'home', 'closer'],
    },
    {
      // Strong handed-in work behind a grade pulled down by work labelled
      // Missing: the best piece leads, then what is not in.
      id: 'hidden',
      tier: 3,
      when: function (a) {
        return a.missing >= 2 && a.missing * 5 >= a.total && a.strongWork;
      },
      order: ['example', 'overall', 'habits', 'attendance', 'nextStep', 'home', 'closer'],
    },
    {
      // The marks climbed over the term, past the "improved" gate
      // (climbed()): the best piece leads, then the strengths.
      id: 'climb',
      tier: 4,
      when: function (a) {
        return a.climb;
      },
      order: ['example', 'overall', 'habits', 'attendance', 'nextStep', 'home', 'closer'],
    },
    {
      // The marks slid over the term, by the same trend (slid()): the best
      // piece first, then the habits before the strengths.
      id: 'slide',
      tier: 4,
      when: function (a) {
        return a.slide;
      },
      order: ['example', 'habits', 'attendance', 'overall', 'nextStep', 'home', 'closer'],
    },
    {
      // Strong in one skill (past the "strongest" gate), weak in another a
      // full proficiency below it on three or more pieces: the strengths and
      // the area to build lead.
      id: 'split',
      tier: 4,
      when: function (a) {
        return a.split;
      },
      order: ['overall', 'example', 'habits', 'attendance', 'nextStep', 'home', 'closer'],
    },
    {
      // Good marks, with two or more habits rated Sometimes or Rarely: the
      // work first, then the habits to build.
      id: 'habits',
      tier: 4,
      when: function (a) {
        return a.growing >= 2 && a.good;
      },
      order: ['example', 'habits', 'attendance', 'overall', 'nextStep', 'home', 'closer'],
    },
    {
      // An A or B (or Proficient and up), nothing missing, no slide: the
      // best piece leads.
      id: 'strength',
      tier: 5,
      when: function (a) {
        return a.high && !a.missing && !a.slide;
      },
      order: ['example', 'overall', 'habits', 'attendance', 'nextStep', 'home', 'closer'],
    },
    {
      // A C or C- (or below Proficient): what is working leads.
      id: 'building',
      tier: 5,
      when: function (a) {
        return a.low;
      },
      order: ['example', 'habits', 'attendance', 'overall', 'nextStep', 'home', 'closer'],
    },
    {
      // No story stands out: the steps in their usual order.
      id: 'steady',
      tier: 6,
      when: function () {
        return true;
      },
      order: DRAFT_STEPS.slice(1)
        .filter(function (s) {
          return !s.ie;
        })
        .map(function (s) {
          return s.key;
        }),
    },
  ];

  /* What the stories are told from, all read off the facts. */
  function angleFacts(f, picks) {
    var g = f.grade || {};
    var pieces = g.pieces || [];
    var work = f.work || [];
    var rec = f.record || {};
    var habits = effectiveHabits((picks && picks.habits) || f.habits, rec, f);
    var letterMode = g.mode === 'letter' || g.mode === 'both';
    var level = Number(f.overall) || 0;
    // Strong in one skill (the "strongest" gate) and a full proficiency
    // lower in another judged on three or more pieces.
    var top = strongestOf(f.comps)[0];
    var split =
      !!top &&
      (f.comps || []).some(function (c) {
        return (c.scores || []).length >= THIN && tenths(top.level) - tenths(c.level) >= 10;
      });
    // The handed-in work on its own: its median %, else its median level.
    var strongWork = pieces.length
      ? pieces.length >= THIN &&
        _median(
          pieces.map(function (p) {
            return Number(p.pct);
          }),
        ) >= 73
      : work.length >= THIN &&
        _median(
          work.map(function (w) {
            return Number(w.v);
          }),
        ) >= 3;
    var joinedLate =
      !!f.enrolled &&
      !!f.classStart &&
      !!f.termStart &&
      f.enrolled > f.termStart &&
      _days(f.classStart, f.enrolled) >= NEW_DAYS;
    return {
      letter: g.letter || '',
      ie: reportPath(f) === 'ie',
      scored: Math.max(pieces.length, work.length),
      missing: _missingCount(f),
      total: rec.total || 0,
      strongWork: strongWork,
      climb: climbed(pieces),
      slide: slid(pieces),
      split: split,
      growing: Object.keys(habits).filter(function (k) {
        return habits[k] === 1 || habits[k] === 2;
      }).length,
      good: letterMode ? ['A', 'B', 'C+'].indexOf(g.letter) >= 0 : level >= 2.5,
      high: letterMode ? g.letter === 'A' || g.letter === 'B' : level >= 3,
      low: letterMode ? g.letter === 'C' || g.letter === 'C-' : level > 0 && level < 2.5,
      joinedLate: joinedLate,
    };
  }

  /* The story for one student: { id, order, lead }. order is the steps
     after the grade sentence; lead is the first of them. opts.uses: how
     many classmates' drafts told each story ({ id: n }), for the tie. */
  /* The stories that fit, at the best tier: angle() picks one of them. */
  function _topAngles(a) {
    var fit = ANGLES.filter(function (x) {
      return x.when(a);
    });
    var tier = Math.min.apply(
      null,
      fit.map(function (x) {
        return x.tier;
      }),
    );
    return fit.filter(function (x) {
      return x.tier === tier;
    });
  }
  function angle(f, picks, opts) {
    var a = angleFacts(f, picks);
    var uses = (opts && opts.uses) || {};
    var pick = _topAngles(a)
      .slice()
      .sort(function (x, y) {
        return (uses[x.id] || 0) - (uses[y.id] || 0) || ANGLES.indexOf(x) - ANGLES.indexOf(y);
      })[0];
    return { id: pick.id, order: _withClassSteps(pick.order, pick.id === 'ie'), lead: pick.order[0] };
  }

  /* The stories told in each class this session, per student, for the
     least-used tie: { cid: { sid: angle id } }. Kept in memory only. */
  var _told = {};
  function _usesFor(cid, sid) {
    var mine = _told[cid] || {};
    var out = {};
    Object.keys(mine).forEach(function (k) {
      if (k !== String(sid)) out[mine[k]] = (out[mine[k]] || 0) + 1;
    });
    return out;
  }

  /* The step a bank sentence belongs to: its part and group, first step in
     DRAFT_STEPS order. */
  function stepOf(s) {
    var st = DRAFT_STEPS.find(function (x) {
      return !!s && !x.line && x.part === s.part && x.groups.indexOf(s.group) >= 0;
    });
    return st ? st.key : null;
  }

  /* The steps a draft runs, in order: the grade, then the angle's order;
     a kept step the angle leaves out goes back where DRAFT_STEPS has it;
     then the teacher's order (step keys) over the steps it names, the
     others keeping their places. */
  function _sequence(order, keptSteps, teacherOrder) {
    var seq = ['grade'].concat(order);
    var all = DRAFT_STEPS.map(function (s) {
      return s.key;
    });
    keptSteps.forEach(function (k) {
      if (seq.indexOf(k) >= 0 || all.indexOf(k) < 0) return;
      var at = 0;
      seq.forEach(function (x, i) {
        if (all.indexOf(x) < all.indexOf(k)) at = i + 1;
      });
      seq.splice(at, 0, k);
    });
    var named = (teacherOrder || []).filter(function (k, i, xs) {
      return seq.indexOf(k) >= 0 && xs.indexOf(k) === i;
    });
    var slots = named
      .map(function (k) {
        return seq.indexOf(k);
      })
      .sort(function (x, y) {
        return x - y;
      });
    slots.forEach(function (at, i) {
      seq[at] = named[i];
    });
    return seq;
  }

  /* Every story's steps with the class's lines in place (plan PR 8): the
     Not Handed In sentence and the late-work line after the habits, the
     support line before the home sentence (else after the next step), and
     the closing sentence last. The IE story states its own problem and
     plan, so it takes no late-work line; its support line comes before
     the meeting sentence (the IEPath mockup). */
  var HABIT_KEYS = ['habits', 'strongHabits', 'attendance'];
  function _withClassSteps(order, ie) {
    var seq = (order || []).slice();
    var at = function (keys) {
      return keys.reduce(function (m, k) {
        return Math.max(m, seq.indexOf(k));
      }, -1);
    };
    var put = function (k, i) {
      if (seq.indexOf(k) < 0) seq.splice(Math.max(0, Math.min(i, seq.length)), 0, k);
    };
    if (!ie) {
      var h = at(HABIT_KEYS);
      put('notHandedIn', h >= 0 ? h + 1 : Math.max(0, at(['nextStep', 'home', 'closer'])));
      put('lateWork', seq.indexOf('notHandedIn') + 1);
      var home = seq.indexOf('home');
      var go = at(['nextStep']);
      var close = seq.indexOf('closer');
      put('support', home >= 0 ? home : go >= 0 ? go + 1 : close >= 0 ? close : seq.length);
      // The language goal line goes before the Next Step sentence, never
      // between it and the family line that follows it (#632).
      put('languageGoals', go >= 0 ? seq.indexOf('nextStep') : seq.indexOf('support'));
    } else {
      var meet = seq.indexOf('ieMeeting');
      put('support', meet >= 0 ? meet : seq.indexOf('closer') >= 0 ? seq.indexOf('closer') : seq.length);
    }
    if (seq.indexOf('closer') < 0) seq.push('closer');
    return seq;
  }

  /* The teacher's kept sentences as { step: { id, text, s } }: opts.kept
     maps a step key or a sentence id (from an earlier draft) to the text
     the teacher wants kept, as written. */
  function _isStep(k) {
    return DRAFT_STEPS.some(function (x) {
      return x.key === k;
    });
  }
  function _bankSentence(bank, id) {
    return bank.sentences.find(function (x) {
      return x.id === id;
    });
  }
  function _kept(kept, bank) {
    var out = {};
    Object.keys(kept || {}).forEach(function (k) {
      var text = String(kept[k] == null ? '' : kept[k]).trim();
      if (!text) return;
      var s = _isStep(k) ? null : _bankSentence(bank, k);
      var step = s ? stepOf(s) : _isStep(k) ? k : null;
      if (step) out[step] = { id: s ? s.id : 'kept:' + step, text: text, s: s || null };
    });
    return out;
  }
  /* The teacher's order (step keys or sentence ids) as step keys. */
  function _orderSteps(order, bank) {
    return (order || [])
      .map(function (k) {
        return _isStep(k) ? k : stepOf(_bankSentence(bank, k));
      })
      .filter(Boolean);
  }

  /* ── Selection: most specific wins, exhaust before repeat ──────────── */

  /* How specific a sentence is for this student: the `when` conditions it
     meets (fits() needs every one met), plus one for the sentence that
     carries the teacher's Note for the Report on the best piece, and one
     for each story slot it needs that holds (climb, split, hidden,
     newcomer), so a sentence written for the student's story comes before
     a general one. Each step keeps only the sentences at its top score. */
  var STORY_SLOTS = ['climb', 'split', 'hidden', 'newcomer'];
  // The stories whose sentences come first: not split, which most classes
  // hold for many students, so its frames mix with the steady ones.
  var STORY_LEADS = ['climb', 'hidden', 'newcomer'];
  function specificity(s, ctx) {
    var needs = s.needs || [];
    var n = Object.keys(s.when || {}).length;
    if (ctx._bestNote && (needs.indexOf('bestPiece') >= 0 || needs.indexOf('bestNote') >= 0)) n++;
    // Progress in levels is as specific as the where-now frames
    // (`when.strengthWord`): the two share the Overall step's tier.
    if (ctx.progressSkill && needs.indexOf('progressSkill') >= 0) n++;
    // Two for a story, so a frame written for the student's story comes
    // before one written for the strongest skill (`when.strongSkill`, bank
    // n6xx-n7xx), which comes before a general one.
    STORY_LEADS.forEach(function (k) {
      if (needs.indexOf(k) >= 0 && ctx[k]) n += 2;
    });
    // A Habit Ratings frame is matched on the same ratings as the summary
    // sentence, so its habit condition makes it no more specific: the two
    // share a tier and rotate, least used first (habitCellFits).
    if (s.habit && s.part === 'habits') n--;
    // A grade frame written for one proficiency word (`when.standing`,
    // bank gr39-gr78) is no more specific than one for any word: the two
    // rotate together, so a Proficiency class is not all one frame family.
    if (s.group === 'Grade' && s.when && s.when.standing) n--;
    return n;
  }

  /* Whether a Habit Ratings frame (bank hl001-hl120: one habit at one
     rating, `habit` and `level`) may fill the habits step: only when exactly
     one habit is rated Sometimes or Rarely and the frame is that habit's,
     so the draft names it specifically; the frame shares the summary's tier
     (specificity) and rotates with its frames, least used first. The
     summary sentence is the only pick everywhere else; Other Wording and
     Browse Sentences offer every frame whose rating matches (fits()). */
  function habitCellFits(s, ctx) {
    return !!s.habit && !!ctx._habitAlone && ctx._habitAlone === s.habit;
  }

  /* Whether a sentence can fill a step for this student, before the rest of
     the draft is known: its part and group, it fits, it names the step's
     preferred slot when that has a value, and no slot the step rules out. */
  function _stepFits(s, step, ctx) {
    if (s.part !== step.part || !fits(s, ctx)) return false;
    if (step.groups && step.groups.indexOf(s.group) < 0) return false;
    // A fact the draft states once (SAYS): the grade sentence says the
    // grade, the Not Handed In sentence the missing work, so a sentence
    // of another step that claims either cannot fill its step (_compose
    // leaves it out); the pool a step draws from (stepPool, bankStrength)
    // says the same.
    var says = {};
    if (ctx._grade) says.grade = true;
    if (ctx.missingWork && ctx._path !== 'ie') says.notHandedIn = true;
    if (
      (s.claims || []).some(function (c) {
        return c !== step.says && SAYS[c] && says[c];
      })
    )
      return false;
    if (step.key === 'habits' && s.habit && !habitCellFits(s, ctx)) return false;
    // The first preferred slot the context has: a sentence must use it.
    var pref = [].concat(step.prefer || []).find(function (k) {
      return !!ctx[k];
    });
    // A step whose preference is soft (`preferSoft`) still takes the
    // teacher's own sentences and the ones bound to the term's story.
    var soft =
      step.preferSoft &&
      (s.mine ||
        (s.needs || []).some(function (k) {
          return STORY_SLOTS.indexOf(k) >= 0 || k === 'progressSkill';
        }));
    if (pref && !soft && (s.needs || []).indexOf(pref) < 0) return false;
    if (
      step.never &&
      slotsOf(s).some(function (k) {
        return step.never.indexOf(k) >= 0;
      })
    )
      return false;
    return true;
  }
  /* Of some sentences, the ones at the top specificity. */
  function _topTier(list, ctx) {
    if (!list.length) return [];
    var top = Math.max.apply(
      null,
      list.map(function (s) {
        return specificity(s, ctx);
      }),
    );
    return list.filter(function (s) {
      return specificity(s, ctx) === top;
    });
  }

  /* The sentences that stand in when a step's top tier is all excluded:
     ones in the step's part that assert nothing (claims []), fit, and are
     not in the draft or excluded, from the step's own groups when it has
     any there. */
  function _standIns(step, ctx, bank, taken, exclude) {
    var ok = bank.sentences.filter(function (s) {
      return (
        s.part === step.part &&
        Array.isArray(s.claims) &&
        !s.claims.length &&
        !taken[s.id] &&
        !exclude[s.id] &&
        fits(s, ctx)
      );
    });
    var own = ok.filter(function (s) {
      return step.groups && step.groups.indexOf(s.group) >= 0;
    });
    return own.length ? own : ok;
  }

  /* The sentences of each student's latest draft this session, per class:
     { cid: { sid: [{ id, text }] } }. A sentence that is mostly slots has
     no pattern to find in a saved comment (pattern()), so its use is known
     only from this record, and only while that classmate's saved comment
     still holds the text drafted. Kept in memory only. */
  var _drafted = {};

  /* How many classmates have each bank sentence: { sentence id: n }. Read
     off their saved comments for this report, so it survives a reload: a
     sentence counts for a classmate when its pattern is in their comment,
     or, for a sentence with no pattern, when this session drafted it for
     them and their comment still holds that text. comments: [{ sid, text }]
     (or plain strings, which only patterns can match). */
  function classUsage(bank, comments, cid, sid) {
    var mine = sid == null ? null : String(sid);
    var list = (comments || [])
      .map(_comment)
      .filter(function (c) {
        return c.sid == null || c.sid !== mine;
      })
      .map(function (c) {
        c.lower = c.text.toLowerCase();
        return c;
      });
    var out = {};
    var add = function (id) {
      out[id] = (out[id] || 0) + 1;
    };
    bank.sentences.forEach(function (s) {
      list.forEach(function (c) {
        if (_holds(s, c.text, c.lower)) add(s.id);
      });
    });
    var record = (cid != null && _drafted[cid]) || {};
    list.forEach(function (c) {
      var seen = {};
      (record[c.sid] || []).forEach(function (x) {
        var s = _bankSentence(bank, x.id);
        if (!s || seen[x.id] || pattern(s) || c.text.indexOf(x.text) < 0) return;
        seen[x.id] = true;
        add(x.id);
      });
    });
    return out;
  }

  /* One pass of the draft over the steps in `seq`. usage: { sentence id:
     classmates } (classUsage()); exclude: { sentence id: true }. */
  function _compose(ctx, bank, seq, kept, seed, usage, exclude) {
    var rand = _rng(seed);
    var byKey = {};
    DRAFT_STEPS.forEach(function (s) {
      byKey[s.key] = s;
    });
    var taken = {};
    var said = {};
    // The steps that have a sentence, for a line that follows one (`after`).
    var got = {};
    var out = [];
    var sentences = [];
    var prov = [];
    // A kept sentence's facts count as said wherever it sits, so no other
    // sentence repeats them.
    Object.keys(kept).forEach(function (k) {
      var s = kept[k].s;
      if (s) taken[s.id] = true;
      ((s && s.needs) || []).forEach(function (n) {
        if (NO_REPEAT[n]) said[NO_REPEAT[n]] = true;
      });
      if (byKey[k].says) said[byKey[k].says] = true;
      if (advises(s)) said.advice = true;
    });
    // The Not Handed In sentence states the work not handed in, and the
    // grade sentence the grade, so no other sentence says either, wherever
    // the teacher's order puts them.
    if (seq.indexOf('notHandedIn') >= 0 && ctx.missingWork) said.notHandedIn = true;
    if (seq.indexOf('grade') >= 0 && ctx._grade) said.grade = true;
    // Whether the Next Step step will give the comment its one next step:
    // it is in the order and a sentence is kept there or fits it. While it
    // will, no other step takes an advising sentence (a Habit Ratings frame
    // at Sometimes or Rarely names a thing to do by design): the habits
    // step takes the summary instead, and the frame stays in Other Wording
    // and Browse Sentences for the teacher to choose (2026-11-01).
    var nextFires =
      seq.indexOf('nextStep') >= 0 &&
      (!!kept.nextStep ||
        bank.sentences.some(function (s) {
          return !exclude[s.id] && _stepFits(s, byKey.nextStep, ctx);
        }));
    seq.forEach(function (key, at) {
      var step = byKey[key];
      // A class line: the teacher's text, as typed (plan PR 8).
      if (step.line && !kept[key]) {
        var lt = String(ctx[step.line] || '').trim();
        if (!lt || (step.after && !got[step.after])) return;
        var lid = 'class:' + key;
        var values = {};
        values[step.line] = lt;
        // A template line (the Language Goals list) is filled for the
        // student and realised with the others; typed text is as typed.
        var ls = { id: lid, text: lt };
        var lfilled = step.template ? fill(ls, ctx) : lt;
        out.push(lfilled);
        var lsent = { id: lid, part: step.part, step: key, text: lfilled, classLine: true };
        if (step.template) {
          lsent.toks = sentenceTokens(ls, ctx);
          lsent.who = whoOf(ctx);
        }
        sentences.push(lsent);
        prov.push({
          sentenceId: lid,
          part: step.part,
          claims: [],
          factKeys: ['class.' + key],
          values: values,
          sources: {},
          classLine: true,
        });
        got[key] = true;
        return;
      }
      if (kept[key]) {
        var kp = kept[key];
        out.push(kp.text);
        sentences.push({ id: kp.id, part: step.part, step: key, text: kp.text, kept: true });
        prov.push({
          sentenceId: kp.id,
          part: step.part,
          claims: [],
          factKeys: [],
          values: {},
          sources: {},
          kept: true,
        });
        got[key] = true;
        return;
      }
      var cands = bank.sentences.filter(function (s) {
        if (taken[s.id] || !_stepFits(s, step, ctx)) return false;
        // A fact the draft already states (the growing habits, the goal, the
        // competency that rose) is not said twice.
        if (
          (s.needs || []).some(function (k) {
            return NO_REPEAT[k] && said[NO_REPEAT[k]];
          })
        )
          return false;
        // One next step a comment (advises): an advising sentence is out
        // once one is in, and out of every other step while the Next Step
        // step will give the comment its one (nextFires).
        if (advises(s) && (said.advice || (key !== 'nextStep' && nextFires))) return false;
        // Once the grade sentence leads, no other sentence states the grade;
        // with a Not Handed In sentence, no other states the missing work.
        if (
          (s.claims || []).some(function (c) {
            return c !== step.says && SAYS[c] && said[c];
          })
        )
          return false;
        return true;
      });
      if (!cands.length) return;
      // Most specific wins: only the top tier is kept.
      var tier = _topTier(cands, ctx).filter(function (s) {
        return !exclude[s.id];
      });
      // The teacher's own sentences (plan PR 10) rank above the shared bank
      // whenever their condition holds: they fit, so they go first. One
      // bound to a part with no case (`general`, Colin Nov 1) is picked
      // only when nothing more specific fits: no personal sentence with a
      // case, and no shared sentence with a `when` it meets.
      var mine = cands.filter(function (s) {
        return s.mine && !exclude[s.id];
      });
      var specific = mine.filter(function (s) {
        return !s.general;
      });
      if (specific.length) tier = _topTier(specific, ctx);
      else if (mine.length && (!tier.length || specificity(tier[0], ctx) === 0)) tier = mine;
      // Every sentence of the top tier is excluded: a sentence that asserts
      // nothing stands in, never a vaguer claim.
      if (!tier.length) tier = _standIns(step, ctx, bank, taken, exclude);
      if (!tier.length) return;
      var last = out.length ? out[out.length - 1].split(/\s+/)[0] : '';
      var sofar = out.join(' ');
      var score = function (s) {
        var t = fill(s, ctx);
        // A quotation already in the draft (the same words twice) is out.
        var quotes = t.match(/“[^”]+”/g) || [];
        var dup = quotes.some(function (q) {
          return sofar.indexOf(q) >= 0;
        });
        return {
          s: s,
          t: t,
          dup: dup ? 1 : 0,
          // A sentence over 20 words as realised (a quoted title as one),
          // after {strengths} has fallen back to one skill (ctxFor), is
          // not offered (the realiser's length rule, 2026-11-01).
          long: R.tooLong(t) ? 1 : 0,
          // Exhaust before repeat: a sentence no classmate has comes before
          // any a classmate has, the least used next.
          used: usage[s.id] || 0,
          // At equal use, wording written for this kind of class first, then
          // a sentence that does not start like the one before it.
          general: s.subjects ? 0 : 1,
          repeats: repeatsLast(t, last) ? 1 : 0,
          // A step that says a fact (the grade, the work not handed in)
          // draws no random number, so the rest of the draft's mix is as it
          // was; its frames are mixed by a hash of the seed and the id
          // instead, so a tie never falls to the bank's order (2026-11-01:
          // the Not Handed In frames m02-m21 were otherwise never picked).
          r: step.says ? seedFor(seed + ':' + s.id) : rand(),
        };
      };
      // A quotation already in the draft is out: now that every title is
      // quoted (the realiser), the same piece is never named twice. So is
      // a sentence over 20 words as realised. When the whole top tier is
      // out this way, the next tier down is tried (Nov 1: the newcomer and
      // even-results frames ran long for some students, and the per-skill
      // frames that fit them were never reached); when every tier is out,
      // a sentence that asserts nothing stands in, as for an excluded tier.
      var fresh = function (x) {
        return !x.dup && !x.long;
      };
      var scored = tier.map(score).filter(fresh);
      var lower = cands.filter(function (s) {
        return !exclude[s.id] && !s.mine && tier.indexOf(s) < 0;
      });
      while (!scored.length && lower.length) {
        var next = _topTier(lower, ctx);
        scored = next.map(score).filter(fresh);
        lower = lower.filter(function (s) {
          return next.indexOf(s) < 0;
        });
      }
      if (!scored.length)
        scored = _standIns(step, ctx, bank, taken, exclude)
          .filter(function (s) {
            return tier.indexOf(s) < 0;
          })
          .map(score)
          .filter(fresh);
      if (!scored.length) return;
      scored.sort(function (a, b) {
        return a.used - b.used || a.general - b.general || a.repeats - b.repeats || a.r - b.r;
      });
      var pick = scored[0];
      taken[pick.s.id] = true;
      (pick.s.needs || []).forEach(function (k) {
        if (NO_REPEAT[k]) said[NO_REPEAT[k]] = true;
      });
      if (step.says) said[step.says] = true;
      if (advises(pick.s)) said.advice = true;
      out.push(pick.t);
      sentences.push({
        id: pick.s.id,
        part: pick.s.part,
        step: key,
        text: pick.t,
        toks: sentenceTokens(pick.s, ctx),
        who: whoOf(ctx),
      });
      prov.push(provenance(pick.s, ctx));
      got[key] = true;
    });
    // The family sentence belongs to the Next Step sentence: without one
    // (no marks to draw a next step from) it is left out, never a lone
    // line. One the teacher kept stays. (A context built by hand, without
    // facts, runs its steps as given.)
    if (ctx._f && !got.nextStep) {
      for (var h = sentences.length - 1; h >= 0; h--) {
        if (sentences[h].step !== 'home' || sentences[h].kept) continue;
        sentences.splice(h, 1);
        prov.splice(h, 1);
        out.splice(h, 1);
      }
    }
    // Never more than nine sentences (plan: six to nine): the family
    // sentence goes first, then attendance (the plan's optional last part),
    // then the strengths. A sentence the teacher kept and the class's
    // lines stay.
    DROP_FIRST.forEach(function (key) {
      if (sentences.length <= MAX_SENTENCES) return;
      for (var i = sentences.length - 1; i >= 0 && sentences.length > MAX_SENTENCES; i--) {
        if (sentences[i].step !== key || sentences[i].kept || sentences[i].classLine) continue;
        sentences.splice(i, 1);
        prov.splice(i, 1);
        out.splice(i, 1);
      }
    });
    return {
      text: out.join(' '),
      ids: sentences.map(function (x) {
        return x.id;
      }),
      sentences: sentences,
      provenance: prov,
    };
  }

  /* A draft from the bank for one student: what the Generate Comment button
     puts in the box. The angle (angle(), from the facts the context was
     built from) sets the steps and their order, the grade sentence first.
     Each step takes, of the sentences that fit, the most specific
     (specificity()); of those, one no classmate has before any a classmate
     has, the least used next (classUsage()), so no sentence repeats in the
     class until that tier is used up; then wording for this kind of class,
     then one that does not start like the sentence before it, then a
     repeatable pick by `seed`. Every draft is verified (verify()) before
     it is returned, so the screen only ever gets text the facts back.

     opts: { seed; comments: classmates' comments this term, [{ sid, text }]
     or plain strings; previous: the text on screen, so each press gives
     another version (the next seeds are tried until the text differs);
     kept: { step key or sentence id: the teacher's text }, kept as written
     in its step; order: step keys or sentence ids in the teacher's order;
     angleUses: { angle id: n } in the class (else this session's drafts in
     the class); exclude: sentence ids never to use (last term's approved
     sentences, from that report's draft_meta: approvedIds()); bank;
     quiet: a draft for a check, not counted in the class's usage;
     charLimit: the class's character limit, the draft fitted to it
     (_fitted); reserve: characters the screen adds to the draft, counted
     against the limit }.

     Returns { text, ids, sentences, provenance, replaced, angle, seed,
     short, overLimit? }: each sentence { id, part, step, text, kept? } in
     order, where each came from (provenance()), what verify() replaced, the story told
     (never shown), the seed used, and whether fewer than six sentences
     were true for this student. A context built by hand, without facts, gets
     the steps in DRAFT_STEPS order and no verify. */
  var RETRIES = 8;
  /* Six to nine sentences (plan): a draft is never longer than nine
     (_compose drops the family sentence, then attendance, then the
     strengths); one with fewer than six says only what is true and carries
     `short: true` for the screen to show. Nothing is ever padded. */
  var MAX_SENTENCES = 9;
  var MIN_SENTENCES = 6;
  var DROP_FIRST = ['home', 'attendance', 'overall'];
  function draft(ctx, opts) {
    opts = opts || {};
    var bank = opts.bank || COMMENT_BANK;
    var f = ctx._f || null;
    var cid = f && f.cid;
    var sid = f && f.sid;
    // quiet: a draft for a check (staleness()), not counted in the class.
    var tally = cid != null && sid != null && !opts.quiet;
    var story = f ? angle(f, ctx._picks, { uses: opts.angleUses || (tally ? _usesFor(cid, sid) : {}) }) : null;
    var kept = _kept(opts.kept, bank);
    var seq = _sequence(
      _withClassSteps(story ? story.order : ANGLES[ANGLES.length - 1].order, !!story && story.id === 'ie'),
      Object.keys(kept),
      _orderSteps(opts.order, bank),
    );
    var previous = String(opts.previous == null ? '' : opts.previous).trim();
    var usage = classUsage(bank, opts.comments, cid, sid);
    var exclude = {};
    (opts.exclude || []).forEach(function (id) {
      exclude[id] = true;
    });
    var base = Number(opts.seed) || 1;
    // The class's character limit (classSettings), less what the screen
    // adds to the draft (the teacher's typed sentences): `reserve`.
    var limit = Number(opts.charLimit) > 0 ? Number(opts.charLimit) - (Number(opts.reserve) || 0) : null;
    var d;
    var seed = base;
    for (var k = 0; k < RETRIES; k++) {
      seed = base + k * 7919;
      // Selection, then the realiser (each sentence filled for its place),
      // then verify.
      d = _fitted(_compose(ctx, bank, seq, kept, seed, usage, exclude), f, ctx, bank, limit);
      if (!previous || d.text !== previous) break;
    }
    if (story && tally) {
      _told[cid] = _told[cid] || {};
      _told[cid][sid] = story.id;
    }
    // The skill a tied strength named (`when.topSkill`), or the even skill
    // named ({evenSkill}), for classmates' picks (topSkillOf, evenSkills):
    // the least-named skill of their tie or even results comes first.
    if (tally) {
      var top = d.provenance.find(function (pv) {
        return !!(pv.values || {})['when.topSkill'];
      });
      var named = top ? top.values['when.topSkill'] : '';
      if (!named) {
        var ev = d.provenance.find(function (pv) {
          return !!(pv.values || {}).evenSkill;
        });
        var evSk =
          ev &&
          (ctx._evenSkills || []).find(function (x) {
            return x.skill === ev.values.evenSkill;
          });
        named = evSk ? evSk.key : '';
      }
      // The highest-marked skill named ({highestSkill}), on the same tally.
      if (!named) {
        var hi = d.provenance.find(function (pv) {
          return !!(pv.values || {}).highestSkill;
        });
        var hiSk =
          hi &&
          (ctx._highestSkills || []).find(function (x) {
            return x.skill === hi.values.highestSkill;
          });
        named = hiSk ? hiSk.key : '';
      }
      if (named) {
        _topTold[cid] = _topTold[cid] || {};
        _topTold[cid][String(sid)] = named;
      } else if (_topTold[cid]) delete _topTold[cid][String(sid)];
    }
    // This draft's bank sentences, for classmates' usage (classUsage()).
    if (tally) {
      _drafted[cid] = _drafted[cid] || {};
      _drafted[cid][String(sid)] = d.sentences
        .filter(function (x) {
          return !x.kept && !x.classLine;
        })
        .map(function (x) {
          return { id: x.id, text: x.text };
        });
    }
    d.angle = story ? story.id : null;
    d.seed = seed;
    d.short = d.sentences.length < MIN_SENTENCES;
    return d;
  }

  /* A composed draft realised and verified, then fitted to the character
     limit (plan: drafts stay within the class's limit): over it, the draft
     drops whole sentences in LIMIT_DROP order until it fits: the family
     line, then attendance, then the strengths, then the habits sentence.
     Nothing else: never the next step, the best piece, the grade sentence,
     Not Handed In, the IE path's Required sentences, a sentence the teacher
     kept, the class's own lines or the comment's first sentence (it names
     the student, and leads a Proficiency class's comment). When
     even that cannot fit, the whole draft is kept and `overLimit` is set;
     the count on screen says why. `limit` null: no limit. */
  var LIMIT_DROP = ['home', 'attendance', 'overall', 'habits', 'strongHabits'];
  function _fitted(c, f, ctx, bank, limit) {
    var finish = function (x) {
      var d = _realised(x);
      if (f) d = verify(d, f, ctx._picks, { bank: bank });
      else d.replaced = [];
      return d;
    };
    var whole = finish(c);
    if (!limit || whole.text.length <= limit) return whole;
    var cur = { sentences: c.sentences.slice(), provenance: c.provenance.slice() };
    for (var k = 0; k < LIMIT_DROP.length; k++) {
      for (var i = cur.sentences.length - 1; i >= 1; i--) {
        var x = cur.sentences[i];
        if (x.step !== LIMIT_DROP[k] || x.kept || x.classLine) continue;
        cur.sentences.splice(i, 1);
        cur.provenance.splice(i, 1);
        var d = finish(cur);
        if (d.text.length <= limit) return d;
      }
    }
    whole.overLimit = true;
    return whole;
  }

  /* A rating changed on the Work Habits grid: the draft `prev` (as draft()
     or this returned it) with only its habits sentence drawn again from ctx,
     built with the new ratings. Every other sentence stays as it was, in
     its place; a habits sentence the draft had none of goes where the
     story puts it, and one that no longer fits is left out. Returns the
     draft's shape plus habits: { before, after }, the old and new habits
     sentences ('' for none); null without a draft. opts: { comments,
     exclude, bank } as for draft(), and steps: the steps drawn again
     (the habits sentence's by default; ATTENDANCE_STEPS after the
     Attendance card changes, which draws the attendance sentence again
     the same way). */
  var HABIT_STEPS = { habits: true, strongHabits: true };
  var ATTENDANCE_STEPS = { attendance: true };
  function redrawHabits(ctx, prev, opts) {
    opts = opts || {};
    var steps = opts.steps || HABIT_STEPS;
    var old = (prev && prev.sentences) || [];
    if (!prev || !old.length) return null;
    var kept = {};
    var order = [];
    old.forEach(function (x) {
      if (!x.step) return;
      order.push(x.step);
      if (!steps[x.step]) kept[x.step] = x.text;
    });
    var f = ctx._f || null;
    var told = f && _told[f.cid] ? _told[f.cid][f.sid] : undefined;
    var d = draft(ctx, {
      seed: prev.seed,
      comments: opts.comments,
      exclude: opts.exclude,
      bank: opts.bank,
      kept: kept,
      order: order,
    });
    // Only the habits sentence is taken from the new draft, with how many of
    // the kept sentences come before it.
    var nu = null;
    var keptBefore = 0;
    d.sentences.forEach(function (x, i) {
      if (nu) return;
      if (steps[x.step]) nu = { s: x, p: d.provenance[i] };
      else if (x.kept) keptBefore++;
    });
    var was = old.find(function (x) {
      return steps[x.step];
    });
    var sentences = [];
    var prov = [];
    var count = 0;
    var put = function () {
      if (!nu) return;
      sentences.push(nu.s);
      prov.push(nu.p);
      nu.placed = true;
    };
    old.forEach(function (x, i) {
      if (steps[x.step]) return put();
      if (nu && !nu.placed && !was && count === keptBefore) put();
      sentences.push(x);
      prov.push((prev.provenance || [])[i]);
      count++;
    });
    if (nu && !nu.placed) put();
    // The story and this student's record stay the draft's own.
    if (f && f.cid != null && f.sid != null) {
      if (told !== undefined) _told[f.cid][f.sid] = told;
      _drafted[f.cid] = _drafted[f.cid] || {};
      _drafted[f.cid][String(f.sid)] = sentences
        .filter(function (x) {
          return !x.kept;
        })
        .map(function (x) {
          return { id: x.id, text: x.text };
        });
    }
    return {
      text: sentences
        .map(function (x) {
          return x.text;
        })
        .join(' '),
      ids: sentences.map(function (x) {
        return x.id;
      }),
      sentences: sentences,
      provenance: prov,
      replaced: d.replaced,
      angle: prev.angle,
      seed: prev.seed,
      habits: { before: was ? was.text : '', after: nu ? nu.s.text : '' },
    };
  }

  /* The Required parts of the comment on the IE or goals path, in the
     comment's order, each filled for the student: { key, label, id, text }
     (plan PR 3). IE: Grade, Problem, Plan, Deadline and Meeting. Goals:
     the Statement that replaces the grade sentence. [] otherwise. A part
     with no sentence that fits has id null and text ''. */
  var REQUIRED_PARTS = {
    ie: [
      ['grade', 'Grade'],
      ['ieProblem', 'Problem'],
      ['iePlan', 'Plan'],
      ['ieDeadline', 'Deadline'],
      ['ieMeeting', 'Meeting'],
    ],
    goals: [['grade', 'Statement']],
  };
  function requiredParts(ctx, bank) {
    bank = bank || COMMENT_BANK;
    var path = ctx && ctx._path;
    var list = path === 'ie' ? REQUIRED_PARTS.ie : path ? REQUIRED_PARTS.goals : [];
    var parts = list.map(function (p) {
      var step = DRAFT_STEPS.find(function (x) {
        return x.key === p[0];
      });
      var s = bank.sentences.find(function (x) {
        return x.part === step.part && step.groups.indexOf(x.group) >= 0 && fits(x, ctx);
      });
      return {
        key: p[0],
        label: p[1],
        id: s ? s.id : null,
        text: '',
        toks: s ? sentenceTokens(s, ctx) : null,
        who: whoOf(ctx),
      };
    });
    // Filled in the comment's order, as the draft fills them (realise()).
    return R.realise(parts).sentences.map(function (x) {
      return { key: x.key, label: x.label, id: x.id, text: x.id ? x.text : '' };
    });
  }

  /* How many sentences fit, in all. */
  function fitCount(ctx, bank) {
    return (bank || COMMENT_BANK).sentences.filter(function (s) {
      return fits(s, ctx);
    }).length;
  }

  /* ── Bank strength (plan PR 13) ───────────────────────────────────── */

  /* Steps whose wording does not come from choosing among bank sentences
     are left out: the grade sentence, the attendance sentence and the work
     not handed in each have one wording per fact (the sentence grammar),
     the best piece and the next step each have one template by design (the
     best-piece forms, the skill-table sentence), class lines are the
     teacher's own text, and the IE path's Required parts are set. What is
     left is what a teacher can widen with sentences of their own. */
  var FIXED_STEPS = { grade: true, attendance: true, notHandedIn: true, example: true, nextStep: true };
  function _strengthSteps() {
    return DRAFT_STEPS.filter(function (s) {
      return !!s.groups && !s.line && !s.ie && !s.says && !FIXED_STEPS[s.key];
    });
  }

  /* The sentences a step of the student's draft picks from: those that can
     fill it (_stepFits), at the top specificity, before the rest of the
     draft is chosen. */
  function stepPool(step, ctx, bank) {
    var def =
      typeof step === 'string'
        ? DRAFT_STEPS.find(function (x) {
            return x.key === step;
          })
        : step;
    if (!def || !def.groups) return [];
    return _topTier(
      (bank || COMMENT_BANK).sentences.filter(function (s) {
        return _stepFits(s, def, ctx);
      }),
      ctx,
    );
  }

  /* The steps the comment runs whichever story it tells: those in every
     story that fits at the best tier (the least-used tie can pick any). */
  function _sureSteps(f, picks) {
    var tops = _topAngles(angleFacts(f, picks));
    var out = {};
    _strengthSteps().forEach(function (s) {
      out[s.key] = tops.every(function (x) {
        return _withClassSteps(x.order, x.id === 'ie').indexOf(s.key) >= 0;
      });
    });
    return out;
  }

  /* How strong the bank is for a class: for each part (a draft step that
     picks among bank sentences), how many sentences fit how many students.
     A student's sentences for a part are their pool (stepPool()); the
     students counted with them are every student in the class whose own
     pool is wholly inside it, since those draw only from these sentences.
     When there are three or more such students for every sentence, some
     sentence must serve three or more of them, and the part is thin for
     that student (the plan's bar; a mere repeat is not thin). A student
     counts for a part only when every story their comment can tell runs
     it; an IE comment counts for none.

     opts: { termId (the report picker's when left out), students (the
     roster when left out), bank }.

     Returns { students: n, parts: [{ step, part, sentences, students,
     thin, worst: { sentences, students } | null }], byStudent: { sid: {
     step: { sentences, students, thin } } } }. A part's `sentences` and
     `students` are the sentences that fit anyone and the students it fits;
     `worst` is its thin group with the most students per sentence. */
  var THIN_PER_SENTENCE = 3;
  function bankStrength(cid, opts) {
    opts = opts || {};
    var bank = opts.bank || COMMENT_BANK;
    var termId =
      'termId' in opts
        ? opts.termId
        : typeof ReportBlocks !== 'undefined' && ReportBlocks.getTermId
          ? ReportBlocks.getTermId()
          : null;
    var roster = opts.students || (typeof getStudents === 'function' ? getStudents(cid) : []) || [];
    var kids = roster.map(function (st) {
      var f = facts(cid, st, termId);
      var rating = (typeof getStudentTermRating === 'function' && getStudentTermRating(cid, st.id, termId)) || {};
      var picks = { habits: rating.habits || {}, focus: rating.focusSectionId || f.focusId };
      return {
        sid: String(st.id),
        ctx: context(f, picks),
        sure: reportPath(f) === 'ie' ? {} : _sureSteps(f, picks),
      };
    });
    var byStudent = {};
    kids.forEach(function (k) {
      byStudent[k.sid] = {};
    });
    var parts = _strengthSteps().map(function (step) {
      var pools = kids.map(function (k) {
        if (!k.sure[step.key]) return null;
        var set = {};
        var n = 0;
        stepPool(step, k.ctx, bank).forEach(function (s) {
          set[s.id] = true;
          n++;
        });
        return n ? { set: set, n: n } : null;
      });
      var inside = function (a, b) {
        for (var id in a.set) if (!b.set[id]) return false;
        return true;
      };
      var all = {};
      var students = 0;
      var worst = null;
      pools.forEach(function (p, i) {
        if (!p) return;
        students++;
        Object.keys(p.set).forEach(function (id) {
          all[id] = true;
        });
        var with_ = pools.filter(function (q) {
          return q && q.n <= p.n && inside(q, p);
        }).length;
        var row = { sentences: p.n, students: with_, thin: with_ >= THIN_PER_SENTENCE * p.n };
        byStudent[kids[i].sid][step.key] = row;
        if (
          row.thin &&
          (!worst ||
            row.students * worst.sentences > worst.students * row.sentences ||
            (row.students * worst.sentences === worst.students * row.sentences && row.students > worst.students))
        )
          worst = { sentences: row.sentences, students: row.students };
      });
      return {
        step: step.key,
        part: step.part,
        sentences: Object.keys(all).length,
        students: students,
        thin: !!worst,
        worst: worst,
      };
    });
    return { students: kids.length, parts: parts, byStudent: byStudent };
  }

  /* ── Near-identical comments ───────────────────────────────────────── */

  /* A comment's sentences, as the realiser splits them (a title such as
     Ms., e.g. or an initial never ends one). */
  function _sentencesOf(text) {
    return R.sentences(text);
  }

  /* A sentence's runs of four words, as a set: lower case, punctuation
     out, the student's own name as one word so classmates' sentences
     compare. */
  var RUN = 4;
  function _runs(sentence, names) {
    var t = String(sentence).toLowerCase();
    (names || []).forEach(function (n) {
      var name = String(n || '')
        .trim()
        .toLowerCase();
      if (!name) return;
      t = t.replace(new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), ' \u0001 ');
    });
    var words = t
      .replace(/[’']s\b/g, ' s')
      .replace(/[^a-z0-9\u0001%+\- ]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    var out = {};
    for (var i = 0; i + RUN <= words.length; i++) out[words.slice(i, i + RUN).join(' ')] = true;
    return out;
  }
  function _sharesRun(a, b) {
    for (var k in a) if (b[k]) return true;
    return false;
  }

  /* Sentences every student must get, which say nothing about how alike
     two comments read: the grade sentence (any wording of the bank's Grade
     group, the IE and goals statements too) and the class's own lines,
     used exactly as typed (the closing sentence, the support lines, the
     late-work line). A class line is matched whole, case, quotes and
     spacing aside. */
  function _lineKey(t) {
    return String(t || '')
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.!?…]+$/, '')
      .toLowerCase();
  }
  function _classLineKeys(cid, lines) {
    var texts = (lines || []).slice();
    if (cid != null) {
      var cs = classSettings(cid);
      texts.push(cs.closing);
      supportChecklist(cid, familyOf(cid)).forEach(function (l) {
        texts.push(l.text);
      });
      languageGoalsChecklist(cid).forEach(function (l) {
        texts.push(l.text);
      });
      var course = (typeof COURSES !== 'undefined' && COURSES[cid]) || {};
      texts.push(course.lateWorkPolicy);
    }
    var out = {};
    texts.forEach(function (t) {
      _sentencesOf(t).forEach(function (x) {
        var k = _lineKey(x);
        if (k) out[k] = true;
      });
    });
    return out;
  }
  function _gradeSentences(bank) {
    var step = DRAFT_STEPS[0];
    return bank.sentences.filter(function (s) {
      return s.part === step.part && step.groups.indexOf(s.group) >= 0;
    });
  }

  /* After the drafts exist for a class: the pairs of comments that read
     alike, each sharing five or more sentences, a sentence shared when it
     has a run of four words in common with a sentence of the other comment
     (each sentence paired once). Sentences every student must get (the
     grade sentence, the class's closing, support and late-work lines) are
     set aside and never count as shared. comments: [{ sid, name, text }],
     `name` (or a list, `names`) the student's names to set aside. Returns
     [{ a, b, shared, pairs: [[sentence in a, sentence in b]] }] by sid,
     most shared first, positions counting every sentence. opts: { min: 5,
     cid: the class, whose lines are set aside; lines: more teacher text to
     set aside; bank }. */
  var NEAR_MIN = 5;
  function nearIdentical(comments, opts) {
    opts = opts || {};
    var min = opts.min || NEAR_MIN;
    var bank = opts.bank || COMMENT_BANK;
    var grades = _gradeSentences(bank);
    var lineKeys = _classLineKeys(opts.cid, opts.lines);
    var mustGet = function (sentence) {
      if (lineKeys[_lineKey(sentence)]) return true;
      var lower = sentence.toLowerCase();
      return grades.some(function (s) {
        return _holds(s, sentence, lower);
      });
    };
    var docs = (comments || [])
      .filter(function (c) {
        return c && String(c.text || '').trim();
      })
      .map(function (c) {
        var names = (c.names || []).concat(c.name ? [c.name] : []);
        return {
          sid: c.sid,
          runs: _sentencesOf(c.text).map(function (s) {
            return mustGet(s) ? {} : _runs(s, names);
          }),
        };
      });
    var out = [];
    for (var i = 0; i < docs.length; i++) {
      for (var j = i + 1; j < docs.length; j++) {
        var a = docs[i];
        var b = docs[j];
        var taken = {};
        var pairs = [];
        a.runs.forEach(function (ra, x) {
          for (var y = 0; y < b.runs.length; y++) {
            if (taken[y] || !_sharesRun(ra, b.runs[y])) continue;
            taken[y] = true;
            pairs.push([x, y]);
            return;
          }
        });
        if (pairs.length >= min) out.push({ a: a.sid, b: b.sid, shared: pairs.length, pairs: pairs });
      }
    }
    return out.sort(function (x, y) {
      return y.shared - x.shared;
    });
  }

  /* ── Verify ────────────────────────────────────────────────────────── */

  /* What each claim a bank sentence makes needs to be true, checked against
     the facts (not the context the draft was filled from). Each check reads
     the sentence's provenance: its values and the fact keys behind each
     slot. A claim with nothing to check fails. */
  function _has(pv, k) {
    return Object.prototype.hasOwnProperty.call(pv.values || {}, k);
  }
  function _ids(pv, slot, kind) {
    return ((pv.sources || {})[slot] || [])
      .filter(function (k) {
        return k.indexOf(kind + ':') === 0;
      })
      .map(function (k) {
        return k.slice(kind.length + 1);
      });
  }
  function _byId(xs, id) {
    return (xs || []).find(function (x) {
      return String(x.id) === String(id);
    });
  }
  function _maxTenths(xs, key) {
    return xs.reduce(function (m, x) {
      return Math.max(m, tenths(x[key]));
    }, -Infinity);
  }
  /* The named items are at the top: none left out is higher than the
     lowest named. */
  function _atTop(named, all, key) {
    if (!named.length || !named.every(Boolean)) return false;
    var floor = Math.min.apply(
      null,
      named.map(function (x) {
        return tenths(x[key]);
      }),
    );
    return all.every(function (x) {
      return named.indexOf(x) >= 0 || tenths(x[key]) <= floor;
    });
  }
  var _article = R.aOrAn;
  /* Work labelled Missing this term (facts().notHandedIn; the record's
     count for facts built without it). */
  function _missingCount(f) {
    if (f.notHandedIn && f.notHandedIn.count != null) return Number(f.notHandedIn.count) || 0;
    return (f.record && f.record.missing) || 0;
  }

  var CLAIMS = {
    // The overall standing: the letter, the proficiency word, or what the
    // work shows overall.
    grade: function (pv, f) {
      var v = pv.values;
      var now = f.overall > 0 ? word(f.overall) : '';
      var checks = [];
      if (_has(pv, 'letterStanding')) checks.push(!!f.letter && v.letterStanding === f.letter);
      if (_has(pv, 'standing')) checks.push(!!now && f.standing === now && v.standing === _article(now) + ' level');
      if (_has(pv, 'when.standing')) checks.push(!!now && f.standing === now && v['when.standing'] === now);
      if (_has(pv, 'evidence')) checks.push(!!v.evidence && v.evidence === evidenceOf(f));
      // The proficiency word alone, in a teacher's own sentence (plan PR 10).
      if (_has(pv, 'standingWord')) checks.push(!!now && f.standing === now && v.standingWord === now);
      // The grade sentence: the kind it was written for (the letter, C-,
      // close to the next letter, the proficiency word) and each grade
      // slot, against gradeOf on the facts.
      var gr = gradeOf(f);
      if (_has(pv, 'when.grade')) checks.push(!!gr && v['when.grade'] === gr.kind);
      var want = gradeSlots(gr);
      Object.keys(want).forEach(function (k) {
        if (_has(pv, k)) checks.push(!!gr && !!want[k] && v[k] === want[k]);
      });
      return checks.length > 0 && checks.every(Boolean);
    },
    // Results are even: every competency with a start and now is at the
    // same proficiency word now.
    even: function (pv, f) {
      var withLevels = f.comps.filter(function (c) {
        return c.start > 0 && c.now > 0;
      });
      var named = _ids(pv, 'even', 'comp');
      return (
        withLevels.length > 1 &&
        named.length === withLevels.length &&
        withLevels.every(function (c) {
          return named.indexOf(String(c.id)) >= 0 && word(c.now) === word(withLevels[0].now);
        })
      );
    },
    // The strongest competencies, or the one the student feels strongest in
    // when the sentence says the work agrees: each past the "strongest"
    // gate (strongestOf).
    // A strengths slot must also be the skill wording from the table for
    // those competencies (strengthsText), never a bare competency label.
    strength: function (pv, f) {
      var v = pv.values || {};
      var ids = _ids(pv, 'strengths', 'comp')
        .concat(_ids(pv, 'strength', 'comp'))
        .concat(_ids(pv, 'strongSkill', 'comp'))
        .concat(_ids(pv, 'strengthNow', 'comp'))
        .concat(_ids(pv, 'selfStrong', 'confidence'));
      // The first strength at its level now (`when.strengthWord`): still the
      // same competency, phrase and level word.
      if (_has(pv, 'strengthNow') || _has(pv, 'when.strengthWord')) {
        var sn = strengthNowOf(f);
        if (
          !sn ||
          (_has(pv, 'strengthNow') &&
            (v.strengthNow !== sn.skill || _ids(pv, 'strengthNow', 'comp')[0] !== String(sn.comp.id))) ||
          (_has(pv, 'when.strengthWord') && v['when.strengthWord'] !== sn.word)
        )
          return false;
      }
      // A frame for one skill (`when.strongSkill`): the first strength is
      // still that skill, from the same competency.
      if (_has(pv, 'when.strongSkill')) {
        var first = strengthSkills(f)[0];
        if (
          !first ||
          first.key !== v['when.strongSkill'] ||
          (_has(pv, 'strongSkill') &&
            (v.strongSkill !== first.key || _ids(pv, 'strongSkill', 'comp')[0] !== String(first.comp.id)))
        )
          return false;
      }
      var gated = strongestOf(f.comps).map(function (c) {
        return String(c.id);
      });
      // A frame for a strength, not the strongest (`when.topSkill`): the
      // competency behind it is the strongest or one of a tie at the top
      // (topTieOf), now, and the key is the table's skill for it. Which of
      // the tie was named is a choice (topSkillOf), not a fact, so a
      // classmate's draft does not make the sentence stale.
      var tops = _ids(pv, 'topSkill', 'comp');
      if (_has(pv, 'when.topSkill')) {
        var tc = tops.length ? _byId(f.comps, tops[0]) : null;
        var tsk = skillFor(f, tc);
        var tied = topTieOf(f.comps).map(function (c) {
          return String(c.id);
        });
        if (
          !tsk ||
          tsk.key !== v['when.topSkill'] ||
          (_has(pv, 'topSkill') && v.topSkill !== tsk.key) ||
          (gated.indexOf(String(tc.id)) < 0 && tied.indexOf(String(tc.id)) < 0)
        )
          return false;
      } else if (tops.length) return false;
      // A frame for the student's own highest-marked skill (highestSkills):
      // no other route holds, the competency behind it is at the highest
      // proficiency among the judged ones and not the next step, the skill
      // is the table's wording for it, the proficiency word bound is its
      // own, and "highest" over every competency still holds where the
      // frame needs it (highestTop). Which of a tie was named is a choice,
      // not a fact.
      var highs = _ids(pv, 'highestSkill', 'comp');
      if (highs.length || _has(pv, 'when.highestSkill') || _has(pv, 'when.highestWord')) {
        var hx = highs.length
          ? highestSkills(f).find(function (x) {
              return String(x.comp.id) === highs[0];
            })
          : null;
        if (
          !hx ||
          (_has(pv, 'highestSkill') && v.highestSkill !== hx.skill) ||
          (_has(pv, 'when.highestSkill') && v['when.highestSkill'] !== hx.key) ||
          (_has(pv, 'when.highestWord') && v['when.highestWord'] !== hx.word) ||
          (_has(pv, 'highestTop') && !highestIsTop(f, hx))
        )
          return false;
      }
      var labels = (f.comps || []).map(function (c) {
        return String(c.name || '');
      });
      var wording = function (k, wants) {
        return !_has(pv, k) || (!!v[k] && wants.indexOf(v[k]) >= 0 && labels.indexOf(v[k]) < 0);
      };
      return (
        ids.length + tops.length + highs.length > 0 &&
        ids.every(function (id) {
          return gated.indexOf(String(id)) >= 0;
        }) &&
        // {strengths} holds both skills, or the strongest alone when two
        // would run the sentence past 20 words (ctxFor).
        wording('strengths', [strengthsText(f), strengthText(f)]) &&
        wording('strength', [strengthText(f)])
      );
    },
    // Even results (evenComps): nothing past the "strongest" gate and every
    // judged competency within half a step, now; the competencies named
    // are those; the skill is the table's wording for one of them (evenSkills);
    // the proficiency word, bound or printed, is the overall one, which every
    // even competency rounds to (printed only where the class shows it,
    // f.standing).
    evenResults: function (pv, f) {
      var v = pv.values || {};
      var ev = evenComps(f.comps, f.overall);
      if (!ev.length) return false;
      var ids = ev.map(function (c) {
        return String(c.id);
      });
      var among = function (slot) {
        var named = _ids(pv, slot, 'comp');
        return (
          named.length > 0 &&
          named.every(function (id) {
            return ids.indexOf(id) >= 0;
          })
        );
      };
      var checks = [];
      if (_has(pv, 'evenResults'))
        checks.push(_ids(pv, 'evenResults', 'comp').length === ids.length && among('evenResults'));
      // The skill named is a choice (evenSkills), not a fact: any even
      // competency on 3+ pieces, in the table's wording for it, holds.
      if (_has(pv, 'evenSkill')) {
        var ec = _byId(f.comps, _ids(pv, 'evenSkill', 'comp')[0]);
        var esk = skillFor(f, ec);
        checks.push(
          among('evenSkill') &&
            !!esk &&
            (ec.scores || []).length >= STRONGEST_PIECES &&
            !!v.evenSkill &&
            v.evenSkill === esk.skill,
        );
      }
      var now = f.overall > 0 ? word(f.overall) : '';
      if (_has(pv, 'when.evenWord')) checks.push(!!now && v['when.evenWord'] === now);
      if (_has(pv, 'evenWord')) checks.push(!!now && !!f.standing && f.standing === now && v.evenWord === now);
      return checks.length > 0 && checks.every(Boolean);
    },
    // Competencies to build: each below the highest now.
    growthArea: function (pv, f) {
      var ids = _ids(pv, 'growthAreas', 'comp')
        .concat(_ids(pv, 'focusLow', 'comp'))
        .concat(_ids(pv, 'selfLow', 'confidence'));
      var top = _maxTenths(f.comps, 'level');
      return (
        ids.length > 0 &&
        ids.every(function (id) {
          var c = _byId(f.comps, id);
          return !!c && tenths(c.level) < top;
        })
      );
    },
    // A competency that rose: past the "improved" gate (improvedComp).
    improved: function (pv, f) {
      var checks = [];
      var ids = _ids(pv, 'rise', 'comp');
      if (ids.length)
        checks.push(
          ids.every(function (id) {
            return improvedComp(_byId(f.comps, id));
          }),
        );
      // The marks climbed over the term (the climb story): the scored
      // pieces' % past the "improved" gate (climbed).
      if (_has(pv, 'climb')) checks.push(climbed((f.grade && f.grade.pieces) || []));
      // Progress in levels: the same competency, climb and phrase (progressOf).
      if (_has(pv, 'progressSkill')) {
        var pg = progressOf(f);
        checks.push(
          !!pg &&
            _ids(pv, 'progressSkill', 'comp')[0] === String(pg.comp.id) &&
            pv.values.progressSkill === pg.skill &&
            (!_has(pv, 'progressFrom') || pv.values.progressFrom === pg.from) &&
            (!_has(pv, 'progressTo') || pv.values.progressTo === pg.to),
        );
      }
      return checks.length > 0 && checks.every(Boolean);
    },
    // Joined the class two weeks or more after it began, this term (the
    // newcomer story, angleFacts).
    newcomer: function (pv, f) {
      return _has(pv, 'newcomer') && angleFacts(f, {}).joinedLate;
    },
    // Strong in one skill (past the "strongest" gate) and a full
    // proficiency lower in another on three or more pieces (the split
    // story, angleFacts).
    split: function (pv, f) {
      return _has(pv, 'split') && angleFacts(f, {}).split;
    },
    slipped: function (pv, f) {
      var checks = [];
      _ids(pv, 'fall', 'comp').forEach(function (id) {
        var c = _byId(f.comps, id);
        checks.push(!!c && c.start > 0 && c.now > 0 && tenths(c.now) < tenths(c.start));
      });
      if (_has(pv, 'fellCount')) {
        var fell = f.comps.filter(function (c) {
          return c.start > 0 && c.now > 0 && word(c.start) === 'Extending' && word(c.now) === 'Proficient';
        });
        checks.push(fell.length > 1 && pv.values.fellCount === (NUM[fell.length] || String(fell.length)));
      }
      return checks.length > 0 && checks.every(Boolean);
    },
    // The highest-marked work this term, with the proficiency it reached.
    bestPiece: function (pv, f) {
      var top = _maxTenths(f.work, 'v');
      var checks = [];
      // The whole best-piece sentence: the top piece, said with its note.
      if (_has(pv, 'bestPiece')) {
        var bw = _byId(f.work, _ids(pv, 'bestPiece', 'work')[0]);
        checks.push(
          !!bw &&
            tenths(bw.v) === top &&
            pv.values.bestPiece ===
              bestPieceSentence({
                title: bw.title,
                note: bw.note,
                skill: (bestPieceSkillOf(f, bw) || {}).skill || '',
                name: f.name,
                pronouns: f.pronouns,
                onFile: f.pronounsOnFile,
              }),
        );
      }
      ['assignment', 'seeWork'].forEach(function (slot) {
        if (!_has(pv, slot)) return;
        var w = _byId(f.work, _ids(pv, slot, 'work')[0]);
        checks.push(!!w && w.title === pv.values[slot] && tenths(w.v) === top);
        if (w && slot === 'assignment' && _has(pv, 'level')) checks.push(pv.values.level === workMark(f, w));
      });
      // The Note for the Report as a slot: the top piece's note, as written.
      if (_has(pv, 'bestNote')) {
        var bn = _byId(f.work, _ids(pv, 'bestNote', 'work')[0]);
        checks.push(!!bn && tenths(bn.v) === top && !!pv.values.bestNote && pv.values.bestNote === noteSlot(bn.note));
      }
      if (_has(pv, 'strongWorks'))
        checks.push(
          _atTop(
            _ids(pv, 'strongWorks', 'work').map(function (id) {
              return _byId(f.work, id);
            }),
            f.work,
            'v',
          ),
        );
      return checks.length > 0 && checks.every(Boolean);
    },
    // Work marked below the best this term.
    weakPiece: function (pv, f) {
      var top = _maxTenths(f.work, 'v');
      var checks = [];
      if (_has(pv, 'assignment2')) {
        var w = _byId(f.work, _ids(pv, 'assignment2', 'work')[0]);
        checks.push(!!w && w.title === pv.values.assignment2 && tenths(w.v) < top);
        if (w && _has(pv, 'level2')) checks.push(pv.values.level2 === workMark(f, w));
      }
      if (_has(pv, 'weakWorks'))
        checks.push(
          _ids(pv, 'weakWorks', 'work').length > 0 &&
            _ids(pv, 'weakWorks', 'work').every(function (id) {
              var x = _byId(f.work, id);
              return !!x && tenths(x.v) < top;
            }),
        );
      return checks.length > 0 && checks.every(Boolean);
    },
    // Two pieces in the Focus Area: the one to show is marked at least as
    // high there as the one to talk about.
    focusWork: function (pv, f) {
      var compId = _ids(pv, 'seeWork', 'comp').concat(_ids(pv, 'aboutWork', 'comp'))[0];
      var c = _byId(f.comps, compId);
      if (!c) return false;
      var marks = function (slot) {
        var id = _ids(pv, slot, 'work')[0];
        return c.scores
          .filter(function (sc) {
            return id != null && String(sc.id) === id && sc.title === pv.values[slot];
          })
          .map(function (sc) {
            return sc.v;
          });
      };
      var see = _has(pv, 'seeWork') ? marks('seeWork') : null;
      var about = _has(pv, 'aboutWork') ? marks('aboutWork') : null;
      if ((see && !see.length) || (about && !about.length) || (!see && !about)) return false;
      return !see || !about || Math.max.apply(null, see) >= Math.min.apply(null, about);
    },
    // The Focus Area and its I Can statement.
    nextStep: function (pv, f) {
      // The next step as a skill: the competency nextStepOf() picks, said
      // with the table's skill for it.
      // A sentence bound to one skill without naming it (a For the Family
      // sentence, `when.nextSkill`): that skill is the next step's.
      if (_has(pv, 'when.nextSkill') && !_has(pv, 'nextSkill')) {
        var ns = nextSkillOf(f);
        return !!ns && ns.key === pv.values['when.nextSkill'];
      }
      // The bank's next step at the student's level (levelStepOf).
      if (_has(pv, 'levelStep')) {
        var ls = levelStepOf(f);
        return !!ls && _ids(pv, 'levelStep', 'comp')[0] === String(ls.comp.id) && pv.values.levelStep === ls.text;
      }
      if (_has(pv, 'nextSkill')) {
        var n = nextSkillOf(f);
        if (!n || _ids(pv, 'nextSkill', 'comp')[0] !== String(n.comp.id) || pv.values.nextSkill !== n.skill)
          return false;
        // A frame for one skill: the next step is still that skill.
        return !_has(pv, 'when.nextSkill') || pv.values['when.nextSkill'] === n.key;
      }
      var compId = _ids(pv, 'focus', 'comp').concat(_ids(pv, 'nextStep', 'comp'))[0];
      var c = _byId(f.comps, compId);
      if (!c) return false;
      if (_has(pv, 'focus') && pv.values.focus !== c.name) return false;
      if (_has(pv, 'nextStep'))
        return (
          c.iCans
            .map(function (t) {
              return _ended(t);
            })
            .indexOf(pv.values.nextStep) >= 0
        );
      return true;
    },
    // The habit ratings the sentence was matched on or names: the habits
    // sentence says what habitSummary gives for the ratings in force.
    habits: function (pv, f, ctx) {
      var eff = ctx._habits || {};
      var sum = habitSummary(eff);
      var checks = [];
      Object.keys(pv.values).forEach(function (k) {
        var m = k.match(/^when\.(\w+)$/);
        if (
          m &&
          [
            'picture',
            'standing',
            'grade',
            'ieProblem',
            'path',
            'nextSkill',
            'strongSkill',
            'topSkill',
            'evenWord',
            'highestSkill',
            'highestWord',
          ].indexOf(m[1]) < 0
        )
          checks.push(eff[m[1]] === pv.values[k]);
      });
      var named = function (slot, ok, want) {
        var ids = _ids(pv, slot, 'habit');
        return (
          ids.length > 0 &&
          ids.join() === want.join() &&
          ids.every(function (k) {
            return ok.indexOf(eff[k]) >= 0;
          })
        );
      };
      if (_has(pv, 'habitsExcellent')) checks.push(sum.excellent);
      if (_has(pv, 'habitsGood')) checks.push(sum.good);
      if (_has(pv, 'habitsAllSeen')) checks.push(sum.seen.length === HABITS.length);
      if (_has(pv, 'habitToBuild')) checks.push(sum.build.length === 1 && named('habitToBuild', [1, 2], sum.build));
      if (_has(pv, 'habitsToBuild')) checks.push(sum.build.length === 2 && named('habitsToBuild', [1, 2], sum.build));
      if (_has(pv, 'habitStrengths'))
        checks.push(!sum.excellent && named('habitStrengths', [CONSISTENTLY], sum.strong.slice(0, 3)));
      if (_has(pv, 'strongHabits'))
        checks.push(!sum.excellent && named('strongHabits', [CONSISTENTLY], sum.strong.slice(0, 3)));
      // On the IE path, never "completes work on time" from the record
      // beside work not handed in or with no mark yet: the comment's own
      // problem says otherwise. Only the teacher's rating says it there.
      if (
        reportPath(f) === 'ie' &&
        !(ctx._rated || {}).completes &&
        _completesClaim(pv, eff) &&
        (_missingCount(f) > 0 || _unmarkedIe(f))
      )
        return false;
      return checks.length > 0 && checks.every(Boolean);
    },
    lateWork: function (pv, f) {
      return !!f.record && f.record.late > 0;
    },
    notHandedIn: function (pv, f) {
      if (_has(pv, 'missingWork') && pv.values.missingWork !== notHandedInSentence(f.notHandedIn)) return false;
      if (_has(pv, 'missingCount') && pv.values.missingCount !== String(_missingCount(f))) return false;
      // The Not Handed In frames: each slot as the facts give it now, and
      // present (a frame for one title is false once there are two).
      var ms = missingSlots(f.notHandedIn);
      var slots = { missingTitle: 'title', missingTitles: 'titles', missingMany: 'many', missingGroup: 'group' };
      for (var k in slots) if (_has(pv, k) && (!ms[slots[k]] || pv.values[k] !== ms[slots[k]])) return false;
      return _missingCount(f) > 0;
    },
    // Marks on fewer of the class's marked work: the counts as said.
    marks: function (pv, f) {
      var m = (f.grade && f.grade.marked) || {};
      if (!(m.all > 0 && m.mine < m.all)) return false;
      if (_has(pv, 'markedMine') && pv.values.markedMine !== numberIn(m.mine)) return false;
      if (_has(pv, 'markedClass') && pv.values.markedClass !== numberIn(m.all)) return false;
      return true;
    },
    // A Required part of an IE comment: the comment is on the IE path, and
    // the problem it names is still the problem.
    ie: function (pv, f) {
      if (reportPath(f) !== 'ie') return false;
      return !_has(pv, 'when.ieProblem') || pv.values['when.ieProblem'] === ieProblemOf(f);
    },
    // A course mark under 50% (calc.js).
    lowMarks: function (pv, f) {
      return !!f.grade && f.grade.pct != null && Number(f.grade.pct) < 50;
    },
    // The IE's deadline as the teacher picked it: never a sentence without
    // a real date ([date], or none picked).
    deadline: function (pv, f) {
      var want = deadlineText(f.grade && f.grade.ieDeadline);
      return reportPath(f) === 'ie' && !!want && _has(pv, 'ieDeadline') && pv.values.ieDeadline === want;
    },
    // The absences and lates as said: "missed three classes and been late
    // once", from the teacher's attendance for the term.
    attendance: function (pv, f) {
      var checks = [];
      if (_has(pv, 'attendance')) {
        var want = attendanceText(f.absent, f.late);
        checks.push(!!want && pv.values.attendance === want);
      }
      // A teacher's own sentence with the classes missed as a number.
      if (_has(pv, 'absentCount')) {
        var a = Math.floor(Number(f.absent)) || 0;
        checks.push(a > 0 && pv.values.absentCount === String(a));
      }
      // The attendance frames: each slot as the counts give it now, and
      // present (an absences-only frame is false once a late is entered).
      var att = attendanceSlots(f.absent, f.late);
      ['absentClasses', 'lateTimes', 'absentOnly', 'lateOnly'].forEach(function (k) {
        if (_has(pv, k)) checks.push(!!att[k] && pv.values[k] === att[k]);
      });
      return checks.length > 0 && checks.every(Boolean);
    },
    // The student's own words and self-assessment.
    studentWords: function (pv, f) {
      var checks = [];
      var said = { selfGood: 'good', selfHard: 'hard', goal: 'goal', plan: 'plan' };
      Object.keys(said).forEach(function (slot) {
        if (_has(pv, slot)) checks.push(!!pv.values[slot] && pv.values[slot] === _quote(f.voice[said[slot]]));
      });
      var conf = f.confidence || [];
      [
        ['selfStrong', 1],
        ['selfLow', -1],
      ].forEach(function (pair) {
        if (!_has(pv, pair[0])) return;
        var e = _byId(conf, _ids(pv, pair[0], 'confidence')[0]);
        checks.push(
          !!e &&
            conf.length > 1 &&
            e.name === pv.values[pair[0]] &&
            (pair[1] > 0 ? e.c >= 3 : e.c <= 2) &&
            conf.every(function (x) {
              return pair[1] > 0 ? x.c <= e.c : x.c >= e.c;
            }),
        );
      });
      return checks.length > 0 && checks.every(Boolean);
    },
    // The picture of the term an opening or closer was written for.
    picture: function (pv, f) {
      return _has(pv, 'when.picture') && pv.values['when.picture'] === pictureOf(f.comps);
    },
    // "Benefits from extra support": nothing in FullVision says so.
    support: function () {
      return false;
    },
  };

  /* Where a sentence came from (provenance) as it was filled with the
     values read back from its text (valuesIn): a skill chosen among
     several valid ones (the even skill, one of a tie at the top, the
     highest-marked skill) is put as named when it is still one of them,
     so its sources are the competency it names, not the one the class's
     rotation would choose now. */
  function provenanceAs(s, ctx, values) {
    var vals = Object.assign({}, values || {});
    var when = (s && s.when) || {};
    Object.keys(when).forEach(function (k) {
      vals['when.' + k] = when[k];
    });
    var pv = provenance(s, ctxFor(s, _asNamed({ values: vals }, ctx)));
    pv.values = Object.assign({}, pv.values, values || {});
    return pv;
  }

  /* The even skill a sentence named ({evenSkill}) is a choice among the
     student's even skills (evenSkills), not a fact: the context holds the
     one it would choose now, so for the check the context is put as the
     sentence was filled, when the skill named is still one of them. The
     claim (CLAIMS.evenResults) checks the competency behind it. */
  function _asNamed(pv, ctx) {
    // One of a tie at the top (`when.topSkill`, topSkillOf) is a choice in
    // the same way: the context as named while that skill is still in the
    // tie (CLAIMS.strength checks the competency behind it).
    var vals = (pv && pv.values) || {};
    var topNamed = vals['when.topSkill'] || vals.topSkill || '';
    if (topNamed && ctx && ctx._f && topNamed !== ctx._topSkill && !strengthSkills(ctx._f).length) {
      var tx = topTieSkills(ctx._f).find(function (e) {
        return e.key === topNamed;
      });
      if (tx)
        ctx = Object.assign({}, ctx, {
          topSkill: tx.key,
          _topSkill: tx.key,
          _facts: Object.assign({}, ctx._facts, { topSkill: ['comp:' + tx.comp.id] }),
          _compNames: Object.assign({}, ctx._compNames, { topSkill: [tx.comp.name] }),
        });
    }
    var hiNamed = (pv && pv.values && pv.values.highestSkill) || '';
    if (hiNamed && ctx && hiNamed !== ctx.highestSkill) {
      var hx = (ctx._highestSkills || []).find(function (e) {
        return e.skill === hiNamed;
      });
      if (hx) ctx = _withHighest(ctx, hx);
    }
    var named = (pv && pv.values && pv.values.evenSkill) || '';
    if (!named || !ctx || named === ctx.evenSkill) return ctx;
    var x = (ctx._evenSkills || []).find(function (e) {
      return e.skill === named;
    });
    if (!x) return ctx;
    return Object.assign({}, ctx, {
      evenSkill: x.skill,
      _facts: Object.assign({}, ctx._facts, { evenSkill: ['comp:' + x.comp.id] }),
      _compNames: Object.assign({}, ctx._compNames, { evenSkill: [x.comp.name] }),
    });
  }

  /* The claims that fail for one sentence, 'slots' when a value it was
     filled with is no longer what the facts give or it no longer fits, and
     'length' when the sentence as realised runs past 20 words (the
     realiser's rule; {strengths} already held to one skill by ctxFor). */
  function _failed(s, pv, f, ctx) {
    var own = Object.prototype.hasOwnProperty;
    var out = [];
    ctx = ctxFor(s, _asNamed(pv, ctx));
    if (R.tooLong(fill(s, ctx))) out.push('length');
    var stale =
      !_fitsSlots(s, ctx, { story: false }) ||
      Object.keys(pv.values || {}).some(function (k) {
        if (/^when\./.test(k) || STORY_SLOTS.indexOf(k) >= 0) return false;
        var now = own.call(ctx, k) && ctx[k] != null ? String(ctx[k]) : '';
        return now !== pv.values[k];
      });
    if (stale) out.push('slots');
    if (!Array.isArray(s.claims)) return out.concat('claims');
    s.claims.forEach(function (c) {
      if (!CLAIMS[c] || !CLAIMS[c](pv, f, ctx)) out.push(c);
    });
    return out;
  }

  /* The no-claim sentence that stands in for a failed one: one in the same
     part that claims nothing, fits, and is not in the draft yet, its own
     group first, then bank order. None when the part has no such sentence. */
  function _fallback(s, ctx, bank, used) {
    var cands = bank.sentences.filter(function (x) {
      return x.part === s.part && Array.isArray(x.claims) && !x.claims.length && !used[x.id] && fits(x, ctx);
    });
    return (
      cands.find(function (x) {
        return x.group === s.group;
      }) ||
      cands[0] ||
      null
    );
  }

  /* Re-check a draft against the facts. Builds the slots afresh from the
     facts and the same picks the draft was made with (context(f, picks)),
     then checks every sentence: each value it was filled with must still be
     what the facts give, and each claim it makes must hold (CLAIMS). A
     sentence that fails is replaced by its part's no-claim sentence, or
     left out when the part has none. Returns the draft's shape { text, ids,
     sentences, provenance } plus `replaced`: [{ sentenceId, failed, by }],
     `by` the stand-in's id or null. opts: { bank }. */
  /* Whether a sentence says the student completes work on time: matched
     on Completes Work at Consistently, naming it among the strong habits,
     or calling every habit excellent with it among them. Only on the IE
     path (claim checks). */
  function _completesClaim(pv, eff) {
    var v = (pv && pv.values) || {};
    if (!pv || !v) return false;
    if (Number(v['when.completes']) === CONSISTENTLY) return true;
    var names = function (slot) {
      return _has(pv, slot) && _ids(pv, slot, 'habit').indexOf('completes') >= 0;
    };
    if (names('habitStrengths') || names('strongHabits')) return true;
    return _has(pv, 'habitsExcellent') && (eff || {}).completes === CONSISTENTLY;
  }

  function verify(d, f, picks, opts) {
    opts = opts || {};
    var bank = opts.bank || COMMENT_BANK;
    var ctx = context(f, picks);
    var byId = {};
    bank.sentences.forEach(function (s) {
      byId[s.id] = s;
    });
    var used = {};
    var prov = (d && d.provenance) || [];
    prov.forEach(function (pv) {
      used[pv.sentenceId] = true;
    });
    var sentences = [];
    var out = [];
    var replaced = [];
    var dated = !!_deadlineOf(f);
    prov.forEach(function (pv, i) {
      var said = String((d.sentences[i] && d.sentences[i].text) || '');
      // A sentence that still says [date] (a comment from before Nov 2):
      // the picked date in its place, else the sentence is left out.
      if (said.indexOf(DATE_PLACEHOLDER) >= 0) {
        if (!dated) {
          replaced.push({ sentenceId: pv.sentenceId, failed: ['deadline'], by: null });
          return;
        }
        var x0 = Object.assign({}, d.sentences[i], { text: withDeadline(said, f.grade.ieDeadline) });
        // Its realiser tokens hold the placeholder: the text as written.
        delete x0.toks;
        sentences.push(x0);
        var vals = Object.assign({}, pv.values);
        if (_has(pv, 'ieDeadline')) vals.ieDeadline = deadlineText(f.grade.ieDeadline);
        out.push(Object.assign({}, pv, { values: vals }));
        return;
      }
      // A sentence the teacher kept is theirs, as written, and so is a class
      // line (support, closing, late work), and a sentence the bank has since
      // retired (RETIRED): not checked.
      if (pv.kept || pv.classLine || (!byId[pv.sentenceId] && RETIRED[pv.sentenceId])) {
        sentences.push(d.sentences[i]);
        out.push(pv);
        return;
      }
      var s = byId[pv.sentenceId];
      var failed = s ? _failed(s, pv, f, ctx) : ['unknown'];
      if (!failed.length) {
        sentences.push(d.sentences[i]);
        out.push(pv);
        return;
      }
      // A deadline sentence with no date picked goes, with no stand-in.
      var stand = s && !(failed.indexOf('deadline') >= 0 && !dated) ? _fallback(s, ctx, bank, used) : null;
      replaced.push({ sentenceId: pv.sentenceId, failed: failed, by: stand ? stand.id : null });
      if (!stand) return;
      used[stand.id] = true;
      var x = {
        id: stand.id,
        part: stand.part,
        text: fill(stand, ctx),
        toks: sentenceTokens(stand, ctx),
        who: whoOf(ctx),
      };
      if (d.sentences[i] && d.sentences[i].step) x.step = d.sentences[i].step;
      sentences.push(x);
      out.push(provenance(stand, ctx));
    });
    // A stand-in is filled for its place like the rest (the realiser).
    return _realised({ sentences: sentences, provenance: out, replaced: replaced });
  }

  /* Bank sentences retired since a draft could have used them (Nov 2: the
     Next Step frames that named a bare label or quoted an I Can). A saved
     draft keeps one as written rather than having it swapped for a
     sentence the teacher didn't choose. */
  var RETIRED = {};
  [
    'g01',
    'g03',
    'g101',
    'g102',
    'g103',
    'g104',
    'g105',
    'g107',
    'g201',
    'g206',
    'g209',
    'g216',
    'g219',
    'g221',
    'g223',
  ].forEach(function (id) {
    RETIRED[id] = true;
  });

  /* ── Marks changed after approval (plan PR 12) ─────────────────────── */

  /* With each approval the screen keeps what the comment was built from
     (term_rating.draft_meta): each sentence's id, part, step, text and
     whether the teacher edited it, the slot values it was filled with, the
     class sentences it used (closing, support, late work) as they were,
     and a hash of the gradebook facts. On a later visit staleness()
     compares that record with today's facts and class settings. Approved
     text is never rewritten here: it only says what changed and what is
     true now, and the teacher decides. */
  var CLASS_SENTENCE_STEPS = { closing: 'closer', support: 'support', late_work: 'lateWork' };
  var STEP_CLASS_SENTENCE = { closer: 'closing', support: 'support', lateWork: 'late_work' };

  /* JSON with every object's keys in order, so the same facts always give
     the same text. */
  function _stable(v) {
    if (Array.isArray(v)) return '[' + v.map(_stable).join(',') + ']';
    if (v && typeof v === 'object') {
      return (
        '{' +
        Object.keys(v)
          .sort()
          .filter(function (k) {
            return v[k] !== undefined && typeof v[k] !== 'function';
          })
          .map(function (k) {
            return JSON.stringify(k) + ':' + _stable(v[k]);
          })
          .join(',') +
        '}'
      );
    }
    return JSON.stringify(v === undefined ? null : v);
  }

  /* Each piece's mark this term, by piece: 'work:<id>' { t: title, m: its
     level and % }, and 'missing:<title>' for work labelled Missing. What
     names the pieces that changed ("“Lab 3” was marked …"). */
  function marksOf(f) {
    var out = {};
    var titles = {};
    ((typeof getAssessments === 'function' && f && getAssessments(f.cid)) || []).forEach(function (a) {
      titles[a.id] = a.title || '';
    });
    ((f && f.work) || []).forEach(function (w) {
      out['work:' + w.id] = { t: w.title || '', m: [w.v, w.pct == null ? '' : w.pct].join('|') };
    });
    ((f && f.grade && f.grade.pieces) || []).forEach(function (p) {
      var k = 'work:' + p.id;
      if (out[k]) out[k].m += '|' + p.pct;
      else out[k] = { t: titles[p.id] || '', m: '|' + p.pct };
    });
    ((f && f.notHandedIn && f.notHandedIn.titles) || []).forEach(function (t) {
      out['missing:' + t] = { t: t, m: 'NS' };
    });
    return out;
  }

  /* A hash of the gradebook facts a comment is built from: every piece's
     mark, the Notes for the Report, the levels per competency, the record
     of work handed in, the course grade and the attendance. The student's
     answers, the habit ratings and the class settings are not in it. */
  function factsHash(f) {
    if (!f) return '';
    var g = f.grade || {};
    var text = _stable({
      marks: marksOf(f),
      notes: (f.work || []).map(function (w) {
        return [w.id, w.note || ''];
      }),
      comps: (f.comps || []).map(function (c) {
        return [c.id, c.start, c.now, c.level];
      }),
      record: f.record || null,
      overall: f.overall || 0,
      letter: f.letter || '',
      grade: [g.mode, g.letter, g.pct, g.basis, g.ieDeadline || '', g.marked || null],
      attendance: [f.absent == null ? null : f.absent, f.late == null ? null : f.late],
    });
    return 'h' + seedFor(text).toString(16) + '.' + seedFor(text.split('').reverse().join('')).toString(16);
  }

  function _clone(v) {
    return v == null ? v : JSON.parse(JSON.stringify(v));
  }

  /* The record kept with an approval, from the rows on screen (the
     Sentences card's: { id, step, text, edited, classLine, raw, prov,
     kept }). A row the teacher chose Keep as Approved on stays kept, and a
     class sentence they kept after an edit stays seen while the comment
     still uses it (opts.prev, the record before). opts: { approvedAt, prev,
     bank }. */
  function draftMeta(rows, f, opts) {
    opts = opts || {};
    var bank = opts.bank || COMMENT_BANK;
    var inBank = {};
    bank.sentences.forEach(function (s) {
      inBank[s.id] = true;
    });
    var sentences = [];
    var slots = {};
    var used = {};
    var keptBefore = {};
    ((opts.prev && opts.prev.sentences) || []).forEach(function (x) {
      if (x && x.kept) keptBefore[x.id + '\u0000' + x.text] = true;
    });
    (rows || []).forEach(function (r) {
      if (!r || !String(r.text || '').trim()) return;
      var x = {
        id: String(r.id),
        part: (r.raw && r.raw.part) || (r.prov && r.prov.part) || null,
        step: r.step || null,
        text: String(r.text),
        edited: !!r.edited,
      };
      if (!r.edited && (r.kept || keptBefore[x.id + '\u0000' + x.text])) x.kept = true;
      if (r.classLine) {
        x.class_line = true;
        var k = STEP_CLASS_SENTENCE[r.step];
        if (k && !r.edited) used[k] = String(r.text);
      } else if (!r.edited && r.prov && inBank[r.id]) {
        x.values = _clone(r.prov.values || {});
        x.sources = _clone(r.prov.sources || {});
        Object.keys(x.values).forEach(function (k) {
          if (!/^when\./.test(k)) slots[k] = x.values[k];
        });
      }
      sentences.push(x);
    });
    var out = {
      v: 1,
      sentences: sentences,
      slots: slots,
      class_sentences: used,
      facts_hash: factsHash(f),
      marks: marksOf(f),
      approved_at: opts.approvedAt || null,
    };
    // The pronouns the comment was written with, so a later change to the
    // student's pronouns is found when the comment is next opened.
    var p = f && f.pronouns;
    if (p && p.subj) {
      out.pronouns = {};
      ['subj', 'obj', 'poss', 'refl', 'verb', 'capSubj'].forEach(function (k) {
        if (p[k] != null) out.pronouns[k] = p[k];
      });
    }
    var prev = opts.prev || {};
    var seen = {};
    Object.keys(prev.class_seen || {}).forEach(function (k) {
      if (used[k] != null && (prev.class_sentences || {})[k] === used[k]) seen[k] = prev.class_seen[k];
    });
    if (Object.keys(seen).length) out.class_seen = seen;
    return out;
  }

  /* The approved sentence ids a draft for the next report leaves out
     (draft()'s exclude): the bank sentences in the record, as approved,
     not the teacher's own. */
  function approvedIds(meta) {
    return ((meta && meta.sentences) || [])
      .filter(function (x) {
        return x && x.id && !x.edited && !x.class_line && !/^(text|class):/.test(String(x.id));
      })
      .map(function (x) {
        return String(x.id);
      });
  }

  /* The pieces whose mark changed between two marksOf() records, by title,
     each once, in the order they come. */
  function changedPieces(was, now) {
    var out = [];
    was = was || {};
    now = now || {};
    Object.keys(was)
      .concat(Object.keys(now))
      .forEach(function (k) {
        var a = was[k];
        var b = now[k];
        if (a && b && a.m === b.m) return;
        var t = String((b && b.t) || (a && a.t) || '').trim();
        if (t && out.indexOf(t) < 0) out.push(t);
      });
    return out;
  }

  /* The sentence that is true now in place of sentence i of an approved
     comment (list: its record's sentences): the same bank sentence filled
     with today's values when it still holds; else the sentence a draft
     gives that step today, every other sentence kept as approved; else
     none ({ text: '' }, the step no longer applies). Filled for its place
     (the realiser). Returns { text, id }. */
  function _nowTrue(list, i, s, f, ctx, bank) {
    var x = list[i];
    if (s && fits(s, ctx) && !_failed(s, provenance(s, ctx), f, ctx).length) {
      var xs = list.map(function (y, j) {
        return j === i
          ? { id: s.id, part: s.part, step: x.step, text: fill(s, ctx), toks: sentenceTokens(s, ctx), who: whoOf(ctx) }
          : { id: y.id, text: y.text };
      });
      return { text: R.realise(xs).sentences[i].text, id: s.id };
    }
    if (!x.step) return { text: '', id: null };
    var kept = {};
    var order = [];
    list.forEach(function (y, j) {
      if (!y.step) return;
      order.push(y.step);
      if (j !== i) kept[y.step] = y.text;
    });
    var d = draft(ctx, { seed: seedFor(String(f.sid)), kept: kept, order: order, bank: bank, quiet: true });
    var hit = d.sentences.find(function (y) {
      return y.step === x.step && !y.kept;
    });
    return hit ? { text: hit.text, id: hit.id } : { text: '', id: null };
  }

  /* What no longer holds in an approved comment, from its record (meta),
     today's facts (f) and the picks it was drafted with ({ habits, focus }).
     A sentence is flagged when a value it claims no longer holds
     (verify() fails it), whether or not the facts hash changed, or when it
     is a class sentence that has been edited since. Sentences the teacher edited, kept as
     approved, or wrote are never flagged.

     Returns null when nothing changed, else { changes: [{ i, kind:
     'marks'|'class', key (class: closing, support, late_work), before:
     the approved sentence, after: the sentence that is true now ('' when
     no sentence fits now) }], pieces: titles whose mark changed, hasGrade,
     gradeChanged, hash, moved: the facts hash differs from the record's }. opts: { text: the saved comment (a change whose
     sentence is no longer in it is dropped), bank }. */
  function staleness(meta, f, picks, opts) {
    opts = opts || {};
    if (!meta || !f || !Array.isArray(meta.sentences) || !meta.sentences.length) return null;
    var bank = opts.bank || COMMENT_BANK;
    var list = meta.sentences;
    var ctx = context(f, picks);
    var changes = [];

    // A class sentence the comment used, edited since (or seen and kept).
    var seen = meta.class_seen || {};
    var cls = meta.class_sentences || {};
    Object.keys(cls).forEach(function (k) {
      var step = CLASS_SENTENCE_STEPS[k];
      var def =
        step &&
        DRAFT_STEPS.find(function (x) {
          return x.key === step;
        });
      if (!def) return;
      var was = String(seen[k] != null ? seen[k] : cls[k]).trim();
      var now = String(ctx[def.line] || '').trim();
      if (now === was) return;
      var i = list.findIndex(function (x) {
        return x && x.class_line && x.step === step && !x.edited;
      });
      if (i < 0 || String(list[i].text).trim() === now) return;
      changes.push({ i: i, kind: 'class', key: k, before: list[i].text, after: now });
    });

    // Marks: every sentence's claim checked against today's facts, also
    // when the facts hash is what it was (a comment approved over a draft
    // the marks had already moved past).
    var hash = factsHash(f);
    var moved = !!meta.facts_hash && meta.facts_hash !== hash;
    var byId = {};
    bank.sentences.forEach(function (s) {
      byId[s.id] = s;
    });
    var at = {};
    var d = { sentences: [], provenance: [] };
    list.forEach(function (x, i) {
      var s = byId[x.id];
      var check = !!s && !x.edited && !x.kept && !x.class_line && !!x.values;
      if (check && !(x.id in at)) at[x.id] = i;
      d.sentences.push({ id: x.id, part: x.part, step: x.step, text: x.text });
      d.provenance.push(
        check
          ? {
              sentenceId: x.id,
              part: s.part,
              claims: (s.claims || []).slice(),
              factKeys: [],
              values: x.values,
              sources: x.sources || {},
            }
          : { sentenceId: x.id, kept: true },
      );
    });
    var v = verify(d, f, picks, { bank: bank });
    (v.replaced || []).forEach(function (r) {
      var i = at[r.sentenceId];
      if (i == null) return;
      var now = _nowTrue(list, i, byId[r.sentenceId], f, ctx, bank);
      if (now.text === list[i].text) return;
      changes.push({ i: i, kind: 'marks', before: list[i].text, after: now.text, id: now.id });
    });

    if (opts.text != null) {
      var text = String(opts.text);
      changes = changes.filter(function (c) {
        return text.indexOf(c.before) >= 0;
      });
    }
    if (!changes.length) return null;
    changes.sort(function (a, b) {
      return a.i - b.i;
    });
    var marks = changes.some(function (c) {
      return c.kind === 'marks';
    });
    return {
      changes: changes,
      pieces: marks && moved ? changedPieces(meta.marks, marksOf(f)) : [],
      moved: moved,
      hasGrade: list.some(function (x) {
        return x && x.step === 'grade';
      }),
      gradeChanged: changes.some(function (c) {
        return c.kind === 'marks' && list[c.i].step === 'grade';
      }),
      hash: hash,
    };
  }

  /* The record after Keep as Approved on one change: a marks change keeps
     that sentence as approved (never checked again); a class change notes
     the class sentence as seen, so only a later edit flags it again. Once
     no marks change is left, the facts as they are now become the record's
     facts. stale: staleness()'s result the change came from. */
  function keepApproved(meta, change, stale, f) {
    var out = _clone(meta) || {};
    if (!change) return out;
    if (change.kind === 'class') {
      out.class_seen = Object.assign({}, out.class_seen || {});
      out.class_seen[change.key] = change.after;
      return out;
    }
    if (out.sentences && out.sentences[change.i]) out.sentences[change.i].kept = true;
    var left = ((stale && stale.changes) || []).some(function (c) {
      return c.kind === 'marks' && c.i !== change.i;
    });
    if (!left && f) {
      out.facts_hash = factsHash(f);
      out.marks = marksOf(f);
    }
    return out;
  }

  /* The sentence bank (shared/comment-bank.js, about 550 KB) is only read
     on the Term Questionnaire, so it is fetched when Reports first needs it
     rather than on every page. Resolves true once COMMENT_BANK exists, false
     if it couldn't be loaded. The teacher's own sentences are installed into
     it as soon as it arrives. sw.js still precaches it for offline use. */
  var _bankLoading = null;
  function loadBank() {
    if (typeof COMMENT_BANK !== 'undefined') return Promise.resolve(true);
    if (_bankLoading) return _bankLoading;
    _bankLoading = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = '/shared/comment-bank.js';
      s.onload = function () {
        if (window.CommentPersonal && typeof CommentPersonal.install === 'function') CommentPersonal.install();
        resolve(typeof COMMENT_BANK !== 'undefined');
      };
      s.onerror = function () {
        _bankLoading = null;
        resolve(false);
      };
      document.head.appendChild(s);
    });
    return _bankLoading;
  }

  return {
    loadBank: loadBank,
    SCALE: SCALE,
    HABITS: HABITS,
    NOT_SEEN: NOT_SEEN,
    USED_BY: USED_BY,
    completesFromRecord: completesFromRecord,
    effectiveHabits: effectiveHabits,
    habitSummary: habitSummary,
    habitCellFits: habitCellFits,
    advises: advises,
    habitWords: habitWords,
    facts: facts,
    notHandedIn: notHandedIn,
    focusOptions: focusOptions,
    context: context,
    fits: fits,
    fill: fill,
    lastStart: lastStart,
    rowMeta: rowMeta,
    repeatsLast: repeatsLast,
    pattern: pattern,
    usedBy: usedBy,
    valuesIn: valuesIn,
    provenanceAs: provenanceAs,
    parts: parts,
    fitCount: fitCount,
    familyOf: familyOf,
    forFamily: forFamily,
    draft: draft,
    redrawHabits: redrawHabits,
    ATTENDANCE_STEPS: ATTENDANCE_STEPS,
    specificity: specificity,
    classUsage: classUsage,
    nearIdentical: nearIdentical,
    bankStrength: bankStrength,
    THIN_PER_SENTENCE: THIN_PER_SENTENCE,
    stepPool: stepPool,
    provenance: provenance,
    verify: verify,
    ctxFor: ctxFor,
    factsHash: factsHash,
    marksOf: marksOf,
    draftMeta: draftMeta,
    approvedIds: approvedIds,
    changedPieces: changedPieces,
    staleness: staleness,
    keepApproved: keepApproved,
    CLAIMS: CLAIMS,
    STANDING: STANDING,
    aOrAn: aOrAn,
    trendingDown: trendingDown,
    closeTo: closeTo,
    workMark: workMark,
    gradeOf: gradeOf,
    ieAllowed: ieAllowed,
    markedCounts: markedCounts,
    ieOffered: ieOffered,
    goalsOffered: goalsOffered,
    reportPath: reportPath,
    ieSource: ieSource,
    ieProblemOf: ieProblemOf,
    deadlineText: deadlineText,
    schoolYear: schoolYear,
    deadlineRange: deadlineRange,
    deadlineOk: deadlineOk,
    withDeadline: withDeadline,
    numberWords: numberWords,
    notHandedInSentence: notHandedInSentence,
    missingSlots: missingSlots,
    attendanceSlots: attendanceSlots,
    strongHabitsPhrase: strongHabitsPhrase,
    requiredParts: requiredParts,
    pictureOf: pictureOf,
    seedFor: seedFor,
    workTitle: workTitle,
    realise: realise,
    EVIDENCE: EVIDENCE,
    HABIT_FAMILY_WORDS: HABIT_FAMILY_WORDS,
    sentenceTokens: sentenceTokens,
    attendanceText: attendanceText,
    reportNoteText: reportNoteText,
    bestPieceSentence: bestPieceSentence,
    studentRef: studentRef,
    DRAFT_STEPS: DRAFT_STEPS,
    ANGLES: ANGLES,
    angle: angle,
    trendOf: trendOf,
    improvedGate: improvedGate,
    improvedComp: improvedComp,
    strengthSkills: strengthSkills,
    strengthsText: strengthsText,
    evenComps: evenComps,
    evenSkills: evenSkills,
    evenSkillText: evenSkillText,
    highestOf: highestOf,
    highestSkills: highestSkills,
    MAX_SENTENCES: MAX_SENTENCES,
    MIN_SENTENCES: MIN_SENTENCES,
    climbed: climbed,
    slid: slid,
    strongestOf: strongestOf,
    strengthNowOf: strengthNowOf,
    progressOf: progressOf,
    bestPieceOf: bestPieceOf,
    bestPieceSkillOf: bestPieceSkillOf,
    compsOf: compsOf,
    topTieOf: topTieOf,
    topTieSkills: topTieSkills,
    topSkillOf: topSkillOf,
    nextStepOf: nextStepOf,
    levelStepOf: levelStepOf,
    sharedNextStep: sharedNextStep,
    skillFor: skillFor,
    bankEntry: bankEntry,
    nextSkillOf: nextSkillOf,
    skillOf: skillOf,
    NO_SKILL: NO_SKILL,
    SKILLS: SKILLS,
    SUPPORT_LINES: SUPPORT_LINES,
    supportLinesFor: supportLinesFor,
    LANGUAGE_GOAL_LINES: LANGUAGE_GOAL_LINES,
    languageGoalsChecklist: languageGoalsChecklist,
    languageGoalChoice: languageGoalChoice,
    supportChecklist: supportChecklist,
    supportChoice: supportChoice,
    supportFit: supportFit,
    fitName: fitName,
    classSettings: classSettings,
    classLines: classLines,
    parseLimit: parseLimit,
    LIMIT_MIN: LIMIT_MIN,
    LIMIT_MAX: LIMIT_MAX,
    passesGates: passesGates,
    angleFacts: angleFacts,
    stepOf: stepOf,
    list: list,
  };
})();
