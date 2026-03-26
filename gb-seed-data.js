/* gb-seed-data.js — Demo seed data for FullVision (extracted from gb-common.js) */

function seedIfNeeded() {
  // Don't re-seed if user deliberately deleted all data
  if (localStorage.getItem('gb-data-wiped') === '1') return;
  var _didSeed = false;
  /* ────────────────────────────────────────────────────────────
     Student roster: Science 8
     ──────────────────────────────────────────────────────────── */
  const SHARED_ROSTER = [
    { id:'st1',  firstName:'Cece',    lastName:'Adeyemi',   preferred:'Cece',    pronouns:'she/her',   studentNumber:'STU-201', dateOfBirth:'2012-04-11', email:'', attendance:[], sortName:'Adeyemi Cece',    enrolledDate:'2025-09-02' },
    { id:'st2',  firstName:'Noor',    lastName:'Al-Rashid', preferred:'Noor',    pronouns:'she/her',   studentNumber:'STU-202', dateOfBirth:'2012-08-23', email:'', attendance:[], sortName:'Al-Rashid Noor',  enrolledDate:'2025-09-02' },
    { id:'st3',  firstName:'Sam',     lastName:'Blackwood', preferred:'Sam',     pronouns:'they/them', studentNumber:'STU-203', dateOfBirth:'2012-01-07', email:'', attendance:[], sortName:'Blackwood Sam',   enrolledDate:'2025-09-02' },
    { id:'st4',  firstName:'Liam',    lastName:'Chen',      preferred:'Liam',    pronouns:'he/him',    studentNumber:'STU-204', dateOfBirth:'2012-06-19', email:'', attendance:[], sortName:'Chen Liam',       enrolledDate:'2025-09-02' },
    { id:'st5',  firstName:'Mateo',   lastName:'Cruz',      preferred:'Mateo',   pronouns:'he/him',    studentNumber:'STU-205', dateOfBirth:'2012-11-02', email:'', attendance:[], sortName:'Cruz Mateo',      enrolledDate:'2025-09-02' },
    { id:'st6',  firstName:'Ethan',   lastName:'Dubois',    preferred:'Ethan',   pronouns:'he/him',    studentNumber:'STU-206', dateOfBirth:'2012-03-30', email:'', attendance:[], sortName:'Dubois Ethan',    enrolledDate:'2025-09-02' },
    { id:'st7',  firstName:'Jasper',  lastName:'Gill',      preferred:'Jas',     pronouns:'he/him',    studentNumber:'STU-207', dateOfBirth:'2012-09-14', email:'', attendance:[], sortName:'Gill Jasper',     enrolledDate:'2025-09-02' },
    { id:'st8',  firstName:'Fatima',  lastName:'Hassan',    preferred:'Fatima',  pronouns:'she/her',   studentNumber:'STU-208', dateOfBirth:'2012-12-05', email:'', attendance:[], sortName:'Hassan Fatima',   enrolledDate:'2025-09-02' },
    { id:'st9',  firstName:'Priya',   lastName:'Kaur',      preferred:'Priya',   pronouns:'she/her',   studentNumber:'STU-209', dateOfBirth:'2012-02-17', email:'', attendance:[], sortName:'Kaur Priya',      enrolledDate:'2025-09-02' },
    { id:'st10', firstName:'Jordan',  lastName:'Kim',       preferred:'Jordan',  pronouns:'he/him',    studentNumber:'STU-210', dateOfBirth:'2012-07-08', email:'', attendance:[], sortName:'Kim Jordan',      enrolledDate:'2025-09-02' },
    { id:'st11', firstName:'Ines',    lastName:'Larsen',    preferred:'Ines',    pronouns:'she/her',   studentNumber:'STU-211', dateOfBirth:'2012-05-25', email:'', attendance:[], sortName:'Larsen Ines',     enrolledDate:'2025-09-02' },
    { id:'st12', firstName:'Marcus',  lastName:'Lee',       preferred:'Marcus',  pronouns:'he/him',    studentNumber:'STU-212', dateOfBirth:'2012-10-13', email:'', attendance:[], sortName:'Lee Marcus',      enrolledDate:'2025-09-02' },
    { id:'st13', firstName:'Amara',   lastName:'Osei',      preferred:'Amara',   pronouns:'she/her',   studentNumber:'STU-213', dateOfBirth:'2012-01-29', email:'', attendance:[], sortName:'Osei Amara',      enrolledDate:'2025-09-02' },
    { id:'st14', firstName:'Sofia',   lastName:'Petrov',    preferred:'Sofia',   pronouns:'she/her',   studentNumber:'STU-214', dateOfBirth:'2012-08-04', email:'', attendance:[], sortName:'Petrov Sofia',    enrolledDate:'2025-09-02' },
    { id:'st15', firstName:'Tyler',   lastName:'Rowe',      preferred:'Tyler',   pronouns:'he/him',    studentNumber:'STU-215', dateOfBirth:'2012-04-22', email:'', attendance:[], sortName:'Rowe Tyler',      enrolledDate:'2025-09-02' },
    { id:'st16', firstName:'Aiden',   lastName:'Singh',     preferred:'Aiden',   pronouns:'he/him',    studentNumber:'STU-216', dateOfBirth:'2012-06-30', email:'', attendance:[], sortName:'Singh Aiden',     enrolledDate:'2025-09-02' },
    { id:'st17', firstName:'Olivia',  lastName:'Tam',       preferred:'Olivia',  pronouns:'she/her',   studentNumber:'STU-217', dateOfBirth:'2012-11-18', email:'', attendance:[], sortName:'Tam Olivia',      enrolledDate:'2025-09-02' },
    { id:'st18', firstName:'Raj',     lastName:'Venkatesh', preferred:'Raj',     pronouns:'he/him',    studentNumber:'STU-218', dateOfBirth:'2012-03-09', email:'', attendance:[], sortName:'Venkatesh Raj',   enrolledDate:'2025-09-02' },
    { id:'st19', firstName:'Maya',    lastName:'Wilson',    preferred:'Maya',    pronouns:'she/her',   studentNumber:'STU-219', dateOfBirth:'2012-09-27', email:'', attendance:[], sortName:'Wilson Maya',     enrolledDate:'2025-09-02' },
    { id:'st20', firstName:'Liv',     lastName:'Zhao',      preferred:'Liv',     pronouns:'she/her',   studentNumber:'STU-220', dateOfBirth:'2012-12-16', email:'', attendance:[], sortName:'Zhao Liv',        enrolledDate:'2025-09-02' },
    { id:'st21', firstName:'Hannah',  lastName:'Berg',      preferred:'Hannah',  pronouns:'she/her',   studentNumber:'STU-221', dateOfBirth:'2012-07-14', email:'', attendance:[], sortName:'Berg Hannah',     enrolledDate:'2025-09-02' },
    { id:'st22', firstName:'Darius',  lastName:'Thompson',  preferred:'Darius',  pronouns:'he/him',    studentNumber:'STU-222', dateOfBirth:'2012-02-08', email:'', attendance:[], sortName:'Thompson Darius', enrolledDate:'2025-09-02' },
    { id:'st23', firstName:'Mei',     lastName:'Wong',      preferred:'Mei',     pronouns:'she/her',   studentNumber:'STU-223', dateOfBirth:'2012-11-30', email:'', attendance:[], sortName:'Wong Mei',        enrolledDate:'2025-09-02' },
    { id:'st24', firstName:'Caleb',   lastName:'Firth',     preferred:'Caleb',   pronouns:'he/him',    studentNumber:'STU-224', dateOfBirth:'2012-05-17', email:'', attendance:[], sortName:'Firth Caleb',     enrolledDate:'2025-09-02' },
    { id:'st25', firstName:'Anisa',   lastName:'Jama',      preferred:'Anisa',   pronouns:'she/her',   studentNumber:'STU-225', dateOfBirth:'2012-09-03', email:'', attendance:[], sortName:'Jama Anisa',      enrolledDate:'2025-09-02' },
    { id:'st26', firstName:'Leo',     lastName:'Martineau', preferred:'Leo',     pronouns:'he/him',    studentNumber:'STU-226', dateOfBirth:'2012-01-22', email:'', attendance:[], sortName:'Martineau Leo',   enrolledDate:'2025-09-02' },
    { id:'st27', firstName:'Tessa',   lastName:'Ironside',  preferred:'Tessa',   pronouns:'she/her',   studentNumber:'STU-227', dateOfBirth:'2012-06-09', email:'', attendance:[], sortName:'Ironside Tessa',  enrolledDate:'2025-09-02' }
  ];


  const STIDS  = SHARED_ROSTER.map(s => s.id);

  /* helper: build score entries from a compact map */
  function buildScores(studentIds, assessments, scoreMap) {
    const sc = {};
    studentIds.forEach((sid, idx) => {
      sc[sid] = [];
      assessments.forEach(a => {
        const baseScore = scoreMap[a.id] ? scoreMap[a.id][idx] : 0;
        if (baseScore === 0) return; // blank — not yet assessed
        (a.tagIds||[]).forEach(tagId => {
          sc[sid].push({
            id: uid(), assessmentId: a.id, tagId, score: baseScore,
            date: a.date, type: a.type, note: '', created: a.created
          });
        });
      });
    });
    return sc;
  }

  /* helper: build quick obs from compact list */
  function buildObs(entries) {
    const obs = {};
    entries.forEach(s => {
      if (!obs[s.sid]) obs[s.sid] = [];
      const ts = new Date(s.date + 'T12:00:00');
      obs[s.sid].push({
        id: 'qo_seed_' + s.sid + '_' + obs[s.sid].length,
        text: s.text, dims: s.dims || [],
        sentiment: s.sentiment || null,
        context: s.context || null,
        created: ts.toISOString(), date: s.date
      });
    });
    return obs;
  }

  /* ════════════════════════════════════════════════════════════
     SCIENCE 8 — SCI8
     ════════════════════════════════════════════════════════════ */
  // Ensure default course exists before seeding
  if (!COURSES.sci8 && Object.keys(COURSES).length === 0) {
    Object.assign(COURSES, structuredClone(DEFAULT_COURSES));
    saveCourses(COURSES);
  }
  if (COURSES.sci8 && getStudents('sci8').length === 0) {
    _didSeed = true;
    saveStudents('sci8', structuredClone(SHARED_ROSTER));
    // Seed the learning map from built-in constants
    if (LEARNING_MAP && LEARNING_MAP.sci8) {
      saveLearningMap('sci8', structuredClone(LEARNING_MAP.sci8));
    }

    const sci8Assessments = [
      { id:'sci8a1',  title:'Cell Microscope Lab',              date:'2025-10-03', type:'summative',  tagIds:['QAP','PI','IP','EM','CA','SC'],      evidenceType:'lab',         notes:'Prepared and examined onion and cheek cells under 400x magnification.', coreCompetencyIds:['CRT','COM'],     rubricId:'rub_sci8_lab', created: new Date('2025-10-03').toISOString() },
      { id:'sci8a2',  title:'Immune System Quick Check',        date:'2025-10-17', type:'formative',  tagIds:['IP','SC'],            evidenceType:'quiz',        notes:'',                                                                      coreCompetencyIds:['CRT'],           created: new Date('2025-10-17').toISOString() },
      { id:'sci8a3',  title:'Disease Research Poster',          date:'2025-10-31', type:'summative',  tagIds:['QAP','IP','CA','SC','EM'], evidenceType:'project',     notes:'Research poster on a communicable disease — cause, transmission, immune response, prevention.', coreCompetencyIds:['COM','CRT','PAR'], rubricId:'rub_sci8_research', created: new Date('2025-10-31').toISOString() },
      { id:'sci8a4',  title:'KMT & States of Matter Lab',       date:'2025-11-14', type:'summative',  tagIds:['QAP','PI','IP','EM','CA','SC'],       evidenceType:'lab',         notes:'Heating/cooling curves and particle diagrams.',                         coreCompetencyIds:['CRT','COM'],     rubricId:'rub_sci8_lab', created: new Date('2025-11-14').toISOString() },
      { id:'sci8a5',  title:'Plate Tectonics Presentation',     date:'2025-12-05', type:'summative',  tagIds:['QAP','IP','EM','CA','SC'],      evidenceType:'observation', notes:'Group presentations on tectonic features.',                             coreCompetencyIds:['COM','COL','CRT'],rubricId:'rub_sci8_research', created: new Date('2025-12-05').toISOString() },
      { id:'sci8a6',  title:'Data Analysis Project',            date:'2025-12-19', type:'summative',  tagIds:['QAP','PI','IP','EM','CA','SC'],  evidenceType:'project',     notes:'Students collected real data, created graphs, calculated central tendency, and drew conclusions.', coreCompetencyIds:['CT','CRT','COM'], rubricId:'rub_sci8_lab', created: new Date('2025-12-19').toISOString() },
      { id:'sci8a7',  title:'Atomic Theory & Elements Quiz',    date:'2026-01-16', type:'formative',  tagIds:['IP','EM'],            evidenceType:'quiz',        notes:'Quick check on periodic table reading and element vs compound identification.',                  coreCompetencyIds:['CRT'],           created: new Date('2026-01-16').toISOString() },
      { id:'sci8a8',  title:'Energy Transfer Investigation',    date:'2026-02-06', type:'summative',  tagIds:['QAP','PI','IP','EM','CA','SC'], evidenceType:'lab',         notes:'Thermal energy transfer experiment using calorimetry.',                  coreCompetencyIds:['CRT','CT'],      rubricId:'rub_sci8_lab', created: new Date('2026-02-06').toISOString() },
      { id:'sci8a9',  title:'Ecosystem Connections Essay',      date:'2026-02-27', type:'summative',  tagIds:['QAP','IP','EM','CA','SC'],       evidenceType:'written',     notes:'Connecting cellular processes to ecosystem interactions.',               coreCompetencyIds:['COM','CRT'],     rubricId:'rub_sci8_research', created: new Date('2026-02-27').toISOString() },
      { id:'sci8a10', title:'Mid-Year Lab Skills Check',        date:'2026-03-14', type:'formative',  tagIds:['PI','EM'],            evidenceType:'observation', notes:'Observed lab technique during independent investigation.',              coreCompetencyIds:['PAR'],           created: new Date('2026-03-14').toISOString() },
      { id:'sci8a11', title:'Photosynthesis vs Respiration Comparison', date:'2025-09-19', type:'summative', tagIds:['QAP','IP','EM','CA','SC'],     evidenceType:'project',     notes:'Compare and contrast photosynthesis and cellular respiration using diagrams and written explanation.', coreCompetencyIds:['CRT','COM'], rubricId:'rub_sci8_research', created: new Date('2025-09-19').toISOString() },
      { id:'sci8a12', title:'Water Quality Field Study',       date:'2025-10-10', type:'summative',  tagIds:['QAP','PI','IP','EM','CA','SC'], evidenceType:'lab',         notes:'Field sampling at Burnaby Lake — tested pH, turbidity, dissolved oxygen.', coreCompetencyIds:['CRT','CT','COM'], rubricId:'rub_sci8_lab', created: new Date('2025-10-10').toISOString() },
      { id:'sci8a13', title:'Periodic Table Scavenger Hunt',   date:'2025-11-07', type:'formative',  tagIds:['IP','EM'],            evidenceType:'quiz',        notes:'Interactive activity matching elements to everyday uses.',                  coreCompetencyIds:['CRT'],           created: new Date('2025-11-07').toISOString() },
      { id:'sci8a14', title:'Circuit Design Challenge',        date:'2025-11-28', type:'summative',  tagIds:['QAP','PI','EM','CA'],      evidenceType:'project',     notes:'Design and build a working circuit with switch, resistor, and LED.',        coreCompetencyIds:['CRT','CT'],      rubricId:'rub_sci8_expdesign', created: new Date('2025-11-28').toISOString() },
      { id:'sci8a15', title:'Mineral Identification Lab',      date:'2025-12-12', type:'summative',  tagIds:['QAP','PI','IP','EM','CA','SC'],       evidenceType:'lab',         notes:'Used hardness, lustre, streak, and cleavage tests to identify 12 mineral samples.', coreCompetencyIds:['CRT','COM'], rubricId:'rub_sci8_lab', created: new Date('2025-12-12').toISOString() },
      { id:'sci8a16', title:'Climate Change Infographic',      date:'2026-01-10', type:'summative',  tagIds:['QAP','IP','EM','CA','SC'],      evidenceType:'project',     notes:'Research-based infographic on causes, effects, and mitigation of climate change.', coreCompetencyIds:['COM','CRT','PAR'], rubricId:'rub_sci8_research', created: new Date('2026-01-10').toISOString() },
      { id:'sci8a17', title:'Forces & Motion Quick Check',     date:'2026-01-31', type:'formative',  tagIds:['PI','EM'],            evidenceType:'quiz',        notes:'Short quiz on Newton\'s laws and force diagrams.',                          coreCompetencyIds:['CRT'],           created: new Date('2026-01-31').toISOString() },
      { id:'sci8a18', title:'Biodiversity Field Journal',      date:'2026-02-14', type:'summative',  tagIds:['QAP','PI','IP','EM','CA','SC'], evidenceType:'written',     notes:'Week-long field journal documenting species observations in school grounds.', coreCompetencyIds:['COM','CRT'],    rubricId:'rub_sci8_report', created: new Date('2026-02-14').toISOString() },
      { id:'sci8a19', title:'Chemical Reactions Lab',          date:'2026-03-07', type:'summative',  tagIds:['QAP','PI','IP','EM','CA','SC'], evidenceType:'lab',         notes:'Conducted five reaction types and classified products using observation and chemical equations.', coreCompetencyIds:['CRT','CT'], rubricId:'rub_sci8_lab', created: new Date('2026-03-07').toISOString() },
      { id:'sci8a20', title:'Science Fair Proposal',           date:'2026-03-21', type:'summative',  tagIds:['QAP','PI','EM','CA'],      evidenceType:'written',     notes:'Written proposal for science fair including question, hypothesis, procedure, and materials list.', coreCompetencyIds:['CRT','COM'], rubricId:'rub_sci8_expdesign', created: new Date('2026-03-21').toISOString() }
    ];
    // ── Science 8 Points-Based Quizzes (12) ──
    sci8Assessments.push(
      { id:'sci8q1',  title:'Cell Structure Quiz',        date:'2025-09-26', type:'formative',  tagIds:['IP'],  evidenceType:'quiz', notes:'', coreCompetencyIds:['CRT'], scoreMode:'points', maxPoints:10, created: new Date('2025-09-26').toISOString() },
      { id:'sci8q2',  title:'Periodic Table Quiz',        date:'2025-10-08', type:'formative',  tagIds:['IP'],  evidenceType:'quiz', notes:'', coreCompetencyIds:['CRT'], scoreMode:'points', maxPoints:15, created: new Date('2025-10-08').toISOString() },
      { id:'sci8q3',  title:'KMT Vocabulary Check',       date:'2025-10-22', type:'formative',  tagIds:['SC'],  evidenceType:'quiz', notes:'', coreCompetencyIds:['COM'], scoreMode:'points', maxPoints:10, created: new Date('2025-10-22').toISOString() },
      { id:'sci8q4',  title:'Lab Safety Quiz',             date:'2025-11-05', type:'formative',  tagIds:['PI'],  evidenceType:'quiz', notes:'', coreCompetencyIds:['PAR'], scoreMode:'points', maxPoints:10, created: new Date('2025-11-05').toISOString() },
      { id:'sci8q5',  title:'Ecology Matching Quiz',       date:'2025-11-19', type:'formative',  tagIds:['IP'],  evidenceType:'quiz', notes:'', coreCompetencyIds:['CRT'], scoreMode:'points', maxPoints:10, created: new Date('2025-11-19').toISOString() },
      { id:'sci8q6',  title:'Chemical Formulas Quiz',      date:'2025-12-03', type:'formative',  tagIds:['IP'],  evidenceType:'quiz', notes:'', coreCompetencyIds:['CRT'], scoreMode:'points', maxPoints:15, created: new Date('2025-12-03').toISOString() },
      { id:'sci8q7',  title:'Plate Tectonics Quiz',        date:'2025-12-17', type:'formative',  tagIds:['QAP'], evidenceType:'quiz', notes:'', coreCompetencyIds:['CRT'], scoreMode:'points', maxPoints:10, created: new Date('2025-12-17').toISOString() },
      { id:'sci8q8',  title:'Energy Forms Quiz',           date:'2026-01-14', type:'formative',  tagIds:['IP'],  evidenceType:'quiz', notes:'', coreCompetencyIds:['CRT'], scoreMode:'points', maxPoints:10, created: new Date('2026-01-14').toISOString() },
      { id:'sci8q9',  title:'Microscope Skills Check',     date:'2026-01-28', type:'formative',  tagIds:['PI'],  evidenceType:'quiz', notes:'', coreCompetencyIds:['PAR'], scoreMode:'points', maxPoints:10, created: new Date('2026-01-28').toISOString() },
      { id:'sci8q10', title:'Scientific Method Quiz',      date:'2026-02-11', type:'formative',  tagIds:['QAP'], evidenceType:'quiz', notes:'', coreCompetencyIds:['CRT'], scoreMode:'points', maxPoints:15, created: new Date('2026-02-11').toISOString() },
      { id:'sci8q11', title:'Body Systems Quiz',           date:'2026-02-25', type:'formative',  tagIds:['IP'],  evidenceType:'quiz', notes:'', coreCompetencyIds:['CRT'], scoreMode:'points', maxPoints:10, created: new Date('2026-02-25').toISOString() },
      { id:'sci8q12', title:'Data Reading Quiz',           date:'2026-03-11', type:'formative',  tagIds:['IP'],  evidenceType:'quiz', notes:'', coreCompetencyIds:['CRT'], scoreMode:'points', maxPoints:10, created: new Date('2026-03-11').toISOString() }
    );
    // ── Science 8 Points-Based Unit Tests (5) ──
    sci8Assessments.push(
      { id:'sci8t1', title:'Cells & Body Systems Unit Test',  date:'2025-10-15', type:'summative', tagIds:['IP','SC'],      evidenceType:'written', notes:'', coreCompetencyIds:['CRT'], scoreMode:'points', maxPoints:60, created: new Date('2025-10-15').toISOString() },
      { id:'sci8t2', title:'Chemistry & Matter Unit Test',    date:'2025-11-26', type:'summative', tagIds:['IP','EM'],      evidenceType:'written', notes:'', coreCompetencyIds:['CRT'], scoreMode:'points', maxPoints:50, created: new Date('2025-11-26').toISOString() },
      { id:'sci8t3', title:'Earth Science Unit Test',         date:'2025-12-10', type:'summative', tagIds:['QAP','IP'],     evidenceType:'written', notes:'', coreCompetencyIds:['CRT'], scoreMode:'points', maxPoints:50, created: new Date('2025-12-10').toISOString() },
      { id:'sci8t4', title:'Ecology & Environment Unit Test', date:'2026-02-04', type:'summative', tagIds:['IP','CA'],      evidenceType:'written', notes:'', coreCompetencyIds:['CRT'], scoreMode:'points', maxPoints:60, created: new Date('2026-02-04').toISOString() },
      { id:'sci8t5', title:'Mid-Year Comprehensive Exam',     date:'2026-03-04', type:'summative', tagIds:['QAP','IP','EM'],evidenceType:'written', notes:'', coreCompetencyIds:['CRT'], scoreMode:'points', maxPoints:80, created: new Date('2026-03-04').toISOString() }
    );
    saveAssessments('sci8', sci8Assessments);

    /* ── Science 8 Rubrics ── */
    const sci8Rubrics = [
      {
        id: 'rub_sci8_lab',
        name: 'Lab Investigation Rubric',
        criteria: [
          {
            id: 'crit_sci8_lab_inquiry',
            name: 'Scientific Inquiry',
            tagIds: ['QAP', 'PI'],
            levels: {
              4: 'Independently designs controlled experiments with multiple variables, demonstrating sophisticated understanding of scientific method.',
              3: 'Plans and conducts fair tests with identified variables and appropriate safety procedures.',
              2: 'Follows a provided experimental procedure with some support in identifying variables.',
              1: 'Participates in experiments with significant teacher guidance; struggles to identify variables independently.'
            }
          },
          {
            id: 'crit_sci8_lab_data',
            name: 'Data & Analysis',
            tagIds: ['IP', 'EM'],
            levels: {
              4: 'Collects precise data, identifies subtle patterns, and provides insightful error analysis that extends beyond expected conclusions.',
              3: 'Collects accurate data, identifies major patterns, and provides reasonable error analysis.',
              2: 'Collects data with some inaccuracies; identifies obvious patterns but error analysis is incomplete.',
              1: 'Data collection is unreliable; struggles to identify patterns or sources of error without direct support.'
            }
          },
          {
            id: 'crit_sci8_lab_comm',
            name: 'Communication',
            tagIds: ['CA', 'SC'],
            levels: {
              4: 'Presents findings with clarity and precision, using sophisticated scientific vocabulary and making meaningful real-world connections.',
              3: 'Presents findings clearly using appropriate scientific vocabulary and connects results to relevant contexts.',
              2: 'Presents basic findings with limited scientific vocabulary; connections to real-world applications are surface-level.',
              1: 'Struggles to present findings coherently; scientific vocabulary is absent or misused.'
            }
          }
        ]
      },
      {
        id: 'rub_sci8_research',
        name: 'Research Project Rubric',
        criteria: [
          {
            id: 'crit_sci8_res_quality',
            name: 'Research Quality',
            tagIds: ['QAP', 'IP'],
            levels: {
              4: 'Evaluates multiple credible sources critically, synthesizing information to build a nuanced understanding of the topic.',
              3: 'Uses several credible sources and demonstrates solid understanding of the research topic.',
              2: 'Uses a limited number of sources with minimal evaluation of credibility; understanding remains surface-level.',
              1: 'Relies on a single source or unreliable sources; research lacks depth and accuracy.'
            }
          },
          {
            id: 'crit_sci8_res_analysis',
            name: 'Critical Analysis',
            tagIds: ['EM', 'CA'],
            levels: {
              4: 'Draws insightful connections between evidence and broader implications, evaluating significance with originality.',
              3: 'Connects evidence to key implications and evaluates the significance of findings appropriately.',
              2: 'Makes basic connections between evidence and conclusions but does not explore broader implications.',
              1: 'Restates information without analysis; does not connect evidence to conclusions.'
            }
          },
          {
            id: 'crit_sci8_res_present',
            name: 'Presentation',
            tagIds: ['SC'],
            levels: {
              4: 'Communicates with exceptional clarity, precise scientific vocabulary, and compelling visual design that enhances understanding.',
              3: 'Communicates clearly with appropriate scientific vocabulary and effective visual elements.',
              2: 'Communication is understandable but lacks scientific vocabulary; visual design is basic or unclear.',
              1: 'Presentation is disorganized and difficult to follow; scientific vocabulary and visuals are largely absent.'
            }
          }
        ]
      },
      {
        id: 'rub_sci8_report',
        name: 'Scientific Report Rubric',
        criteria: [
          {
            id: 'crit_sci8_report_hyp',
            name: 'Hypothesis & Method',
            tagIds: ['QAP', 'PI'],
            levels: {
              4: 'Crafts a precise, testable hypothesis and designs a method that anticipates confounding variables with clear scientific reasoning.',
              3: 'States a testable hypothesis and outlines a logical method with appropriate controls.',
              2: 'Hypothesis is present but vague; method is partially developed and missing key controls.',
              1: 'Hypothesis is untestable or absent; method lacks logical structure and needs significant teacher support.'
            }
          },
          {
            id: 'crit_sci8_report_results',
            name: 'Results & Discussion',
            tagIds: ['IP', 'EM'],
            levels: {
              4: 'Results are organized with precision and the discussion draws insightful connections to theory, acknowledging limitations thoughtfully.',
              3: 'Results are clearly presented and the discussion connects findings to the hypothesis with reasonable interpretation.',
              2: 'Results are present but disorganized; discussion restates findings without meaningful interpretation.',
              1: 'Results are incomplete or inaccurate; discussion is absent or does not relate to the original hypothesis.'
            }
          },
          {
            id: 'crit_sci8_report_writing',
            name: 'Scientific Writing',
            tagIds: ['SC'],
            levels: {
              4: 'Writing is polished and precise, using discipline-specific terminology naturally and maintaining a formal scientific tone throughout.',
              3: 'Writing is clear and organized with appropriate scientific vocabulary and a consistent formal tone.',
              2: 'Writing is understandable but informal in places; scientific vocabulary is used inconsistently.',
              1: 'Writing is disorganized and lacks scientific vocabulary; tone is conversational rather than formal.'
            }
          }
        ]
      },
      {
        id: 'rub_sci8_grouppres',
        name: 'Group Presentation Rubric',
        criteria: [
          {
            id: 'crit_sci8_grouppres_content',
            name: 'Content Knowledge',
            tagIds: ['IP', 'CA'],
            levels: {
              4: 'Demonstrates thorough, accurate content knowledge and extends ideas beyond the curriculum with creative real-world connections.',
              3: 'Demonstrates solid content knowledge and makes relevant connections to real-world contexts.',
              2: 'Content is mostly accurate but shallow; connections to broader contexts are limited or forced.',
              1: 'Content contains significant inaccuracies; understanding of key concepts is not evident.'
            }
          },
          {
            id: 'crit_sci8_grouppres_delivery',
            name: 'Delivery & Engagement',
            tagIds: ['SC'],
            levels: {
              4: 'Speaks with confidence and engages the audience through compelling visuals, pacing, and interaction that enhances understanding.',
              3: 'Speaks clearly, maintains audience attention, and uses visuals effectively to support key points.',
              2: 'Delivery is understandable but relies heavily on reading notes; visuals are present but do not enhance the message.',
              1: 'Delivery is difficult to follow; lacks eye contact and visuals are missing or distracting.'
            }
          },
          {
            id: 'crit_sci8_grouppres_collab',
            name: 'Collaboration',
            tagIds: ['QAP'],
            levels: {
              4: 'All group members contribute meaningfully, building on each other\'s ideas and demonstrating a seamless, well-rehearsed presentation.',
              3: 'Group members share responsibilities fairly and support one another during the presentation.',
              2: 'Contributions are uneven across the group; some members dominate while others are passive.',
              1: 'Little evidence of group collaboration; presentation feels like disconnected individual parts.'
            }
          }
        ]
      },
      {
        id: 'rub_sci8_datagraph',
        name: 'Data Collection & Graphing Rubric',
        criteria: [
          {
            id: 'crit_sci8_datagraph_accuracy',
            name: 'Data Accuracy',
            tagIds: ['PI', 'IP'],
            levels: {
              4: 'Collects data with meticulous precision, records appropriate units and significant figures, and identifies anomalies independently.',
              3: 'Collects accurate data with correct units and reasonable precision; notes obvious anomalies.',
              2: 'Data is mostly complete but contains errors in recording or units; anomalies go unnoticed.',
              1: 'Data is incomplete or unreliable; units are missing and precision is not considered.'
            }
          },
          {
            id: 'crit_sci8_datagraph_graph',
            name: 'Graph Construction & Interpretation',
            tagIds: ['IP', 'SC'],
            levels: {
              4: 'Constructs publication-quality graphs with appropriate scales, labels, and trend lines, and interprets patterns with sophisticated reasoning.',
              3: 'Constructs clear, correctly labelled graphs with appropriate scales and interprets major trends accurately.',
              2: 'Graphs are present but have errors in scale, labelling, or type; interpretation of trends is superficial.',
              1: 'Graphs are missing key elements or are inappropriate for the data; unable to interpret trends without support.'
            }
          }
        ]
      },
      {
        id: 'rub_sci8_expdesign',
        name: 'Experimental Design Rubric',
        criteria: [
          {
            id: 'crit_sci8_expdesign_vars',
            name: 'Variable Identification',
            tagIds: ['QAP', 'PI'],
            levels: {
              4: 'Identifies all variables with precision, explains the rationale for controls, and anticipates potential confounds in the design.',
              3: 'Correctly identifies independent, dependent, and controlled variables with clear explanations.',
              2: 'Identifies some variables but confuses their roles or overlooks important controlled variables.',
              1: 'Cannot distinguish between variable types without direct teacher guidance.'
            }
          },
          {
            id: 'crit_sci8_expdesign_procedure',
            name: 'Procedure & Safety',
            tagIds: ['PI', 'EM'],
            levels: {
              4: 'Writes a detailed, replicable procedure that proactively addresses safety risks and includes thoughtful contingency steps.',
              3: 'Writes a clear, step-by-step procedure with appropriate safety precautions identified.',
              2: 'Procedure is present but lacks detail for replication; safety precautions are mentioned but incomplete.',
              1: 'Procedure is vague or missing steps; safety considerations are absent.'
            }
          },
          {
            id: 'crit_sci8_expdesign_predict',
            name: 'Prediction & Reasoning',
            tagIds: ['QAP', 'CA'],
            levels: {
              4: 'Makes well-reasoned predictions grounded in scientific theory and explains the reasoning with depth and originality.',
              3: 'Makes logical predictions supported by prior knowledge and provides clear scientific reasoning.',
              2: 'Makes a prediction but the reasoning behind it is weak or not clearly connected to science concepts.',
              1: 'Prediction is a guess without scientific reasoning; cannot explain why the outcome is expected.'
            }
          }
        ]
      },
      {
        id: 'rub_sci8_reflect',
        name: 'Science Reflection Rubric',
        criteria: [
          {
            id: 'crit_sci8_reflect_self',
            name: 'Self-Assessment',
            tagIds: ['EM', 'CA'],
            levels: {
              4: 'Provides honest, detailed self-assessment with specific evidence, demonstrating strong metacognitive awareness of personal learning.',
              3: 'Accurately self-assesses strengths and areas for growth with supporting examples from their work.',
              2: 'Self-assessment is present but generic; lacks specific evidence or meaningful insight into learning.',
              1: 'Self-assessment is superficial or inaccurate; does not identify meaningful strengths or areas for growth.'
            }
          },
          {
            id: 'crit_sci8_reflect_growth',
            name: 'Growth Identification',
            tagIds: ['SC'],
            levels: {
              4: 'Articulates a clear growth trajectory with specific goals and strategies, connecting learning to future scientific pursuits.',
              3: 'Identifies areas of growth and sets reasonable goals for continued improvement in science.',
              2: 'Mentions growth in general terms but goals are vague and lack actionable strategies.',
              1: 'Does not identify growth or set goals; reflection is a summary rather than a forward-looking analysis.'
            }
          }
        ]
      }
    ];
    // ── Extra rubrics in the bank (not yet assigned to assessments) ──
    sci8Rubrics.push(
      {
        id: 'rub_sci8_debate',
        name: 'Science Debate Rubric',
        criteria: [
          { id: 'crit_debate_claim', name: 'Claim & Evidence', tagIds: ['IP', 'EM'],
            levels: { 4:'Constructs a compelling, evidence-based argument that anticipates and refutes counterarguments with scientific precision.', 3:'Presents a clear claim supported by relevant evidence and addresses at least one counterargument.', 2:'States a claim with some evidence but does not address counterarguments or relies on opinion.', 1:'Claim is unclear or unsupported; argument relies on personal belief rather than evidence.' } },
          { id: 'crit_debate_delivery', name: 'Oral Delivery', tagIds: ['SC'],
            levels: { 4:'Speaks persuasively with poise, using scientific vocabulary naturally and engaging the audience throughout.', 3:'Speaks clearly with appropriate vocabulary and maintains audience attention.', 2:'Delivery is understandable but monotone or overly reliant on notes; vocabulary is limited.', 1:'Delivery is difficult to follow; reads directly from notes without engaging the audience.' } },
          { id: 'crit_debate_respond', name: 'Responding to Others', tagIds: ['QAP', 'CA'],
            levels: { 4:'Listens actively, responds to opposing views with respect and precision, and builds on others\' ideas to strengthen the debate.', 3:'Responds to opposing views respectfully and provides relevant counterpoints.', 2:'Acknowledges opposing views but responses are generic or miss the main point.', 1:'Does not engage with opposing views or responds dismissively.' } }
        ]
      },
      {
        id: 'rub_sci8_model',
        name: 'Scientific Model Rubric',
        criteria: [
          { id: 'crit_model_accuracy', name: 'Scientific Accuracy', tagIds: ['IP', 'EM'],
            levels: { 4:'Model is scientifically accurate, includes all key components, and represents relationships between concepts with sophistication.', 3:'Model is accurate and includes major components with clear labels and correct relationships.', 2:'Model includes some accurate components but has errors or missing relationships.', 1:'Model contains significant scientific inaccuracies or is missing most key components.' } },
          { id: 'crit_model_visual', name: 'Visual Communication', tagIds: ['SC', 'CA'],
            levels: { 4:'Model is visually compelling, uses colour, scale, and labels purposefully, and could stand alone as a teaching tool.', 3:'Model is neat, clearly labelled, and uses visual elements to support understanding.', 2:'Model is present but cluttered, poorly labelled, or lacks visual clarity.', 1:'Model is incomplete, messy, or so poorly organized that it hinders understanding.' } },
          { id: 'crit_model_explain', name: 'Explanation & Connection', tagIds: ['QAP'],
            levels: { 4:'Provides a detailed written or verbal explanation connecting the model to real-world phenomena and identifying its limitations.', 3:'Explains what the model represents and connects it to at least one real-world example.', 2:'Provides a basic explanation of the model but does not connect it to real-world contexts.', 1:'Cannot explain the model or its purpose without significant teacher prompting.' } }
        ]
      },
      {
        id: 'rub_sci8_fieldwork',
        name: 'Fieldwork & Observation Rubric',
        criteria: [
          { id: 'crit_field_observe', name: 'Observation Quality', tagIds: ['QAP', 'PI'],
            levels: { 4:'Makes detailed, systematic observations using multiple senses and tools; records quantitative and qualitative data with precision.', 3:'Makes careful observations and records both quantitative and qualitative data accurately.', 2:'Makes basic observations but data recording is inconsistent or lacks detail.', 1:'Observations are superficial or incomplete; data recording is missing or unreliable.' } },
          { id: 'crit_field_record', name: 'Field Notes & Sketches', tagIds: ['IP', 'SC'],
            levels: { 4:'Field notes are thorough, well-organized, and include detailed labelled sketches that capture key features with scientific accuracy.', 3:'Field notes are organized and include clear sketches with appropriate labels.', 2:'Field notes are present but disorganized; sketches are rough or missing labels.', 1:'Field notes are minimal or absent; no meaningful sketches or records of observations.' } },
          { id: 'crit_field_connect', name: 'Ecological Connections', tagIds: ['EM', 'CA'],
            levels: { 4:'Identifies complex ecological relationships, connects observations to broader environmental concepts, and proposes thoughtful questions for further study.', 3:'Identifies key ecological relationships and connects observations to classroom concepts.', 2:'Identifies some ecological relationships but connections to broader concepts are weak.', 1:'Cannot identify ecological relationships without direct teacher guidance.' } }
        ]
      },
      {
        id: 'rub_sci8_techdesign',
        name: 'Technology & Design Challenge Rubric',
        criteria: [
          { id: 'crit_tech_solution', name: 'Design & Solution', tagIds: ['CA', 'QAP'],
            levels: { 4:'Designs an innovative, functional solution that exceeds specifications, incorporating creative modifications based on testing.', 3:'Designs a functional solution that meets specifications and incorporates at least one modification from testing.', 2:'Designs a partially functional solution; limited testing and modifications were attempted.', 1:'Solution does not function or does not address the design challenge; no testing occurred.' } },
          { id: 'crit_tech_process', name: 'Engineering Process', tagIds: ['PI', 'EM'],
            levels: { 4:'Documents the full design cycle with detailed iterations, explains trade-offs in material/method choices, and evaluates the final product critically.', 3:'Documents the design-build-test cycle with clear explanations of choices and at least one iteration.', 2:'Some documentation of the process but key steps are missing; limited reflection on choices.', 1:'No documentation of the design process; cannot explain the reasoning behind choices.' } },
          { id: 'crit_tech_collab', name: 'Teamwork & Communication', tagIds: ['SC'],
            levels: { 4:'Leads collaborative design discussions, delegates tasks effectively, and presents the design rationale with clarity and confidence.', 3:'Contributes actively to team discussions, shares responsibilities, and communicates design choices clearly.', 2:'Participates in group work but contributions are uneven; communication of design choices is limited.', 1:'Minimal participation in teamwork; relies on others to make design decisions and present.' } }
        ]
      },
      {
        id: 'rub_sci8_peerreview',
        name: 'Peer Review Rubric',
        criteria: [
          { id: 'crit_peer_feedback', name: 'Quality of Feedback', tagIds: ['EM', 'SC'],
            levels: { 4:'Provides specific, constructive feedback that identifies both strengths and areas for improvement with actionable suggestions grounded in criteria.', 3:'Provides clear feedback identifying strengths and areas for improvement with specific examples.', 2:'Feedback is present but vague or focuses only on positives without suggesting improvements.', 1:'Feedback is absent, unhelpful, or limited to generic praise like "good job."' } },
          { id: 'crit_peer_engage', name: 'Engagement with Peer Work', tagIds: ['IP', 'CA'],
            levels: { 4:'Reads/reviews peer work thoroughly, asks clarifying questions, and demonstrates genuine interest in understanding their approach.', 3:'Reads/reviews peer work carefully and provides comments that show engagement with the content.', 2:'Skims peer work and provides surface-level comments that don\'t demonstrate deep engagement.', 1:'Does not meaningfully engage with peer work; feedback suggests the work was not read carefully.' } }
        ]
      }
    );
    saveRubrics('sci8', sci8Rubrics);

    //  Distribution: Extending(st2,st9,st13), Proficient(st1,st3,st4,st5,st7,st8,st10,st11,st14,st17,st19,st20), Developing(st6,st12,st15,st16,st18), Emerging(st3 early only — shows growth)
    //  0 = not yet assessed (blank)
    const sci8ScoreMap = {
      sci8a1:  [3,4,2,3,3,2,3,3,4,3,3,2,4,3,2,2,3,2,3,3, 3,2,4,3,3,2,3],
      sci8a2:  [3,4,3,3,3,2,3,3,4,3,3,2,4,3,2,2,3,2,3,3, 3,3,4,2,3,2,3],
      sci8a3:  [3,4,3,3,3,2,3,3,4,3,3,2,4,3,2,2,3,2,3,3, 3,2,3,3,4,3,3],
      sci8a4:  [3,4,3,3,3,2,3,3,4,3,3,2,4,3,2,2,3,2,3,3, 2,3,4,3,3,2,3],
      sci8a5:  [3,4,3,4,3,2,3,3,4,3,3,2,4,3,2,3,3,2,3,3, 3,2,3,3,3,3,4],
      sci8a6:  [3,4,3,3,3,2,4,3,4,3,3,2,4,3,2,2,3,2,3,3, 3,3,4,2,3,2,3],
      sci8a7:  [3,4,3,3,3,2,3,3,4,3,3,2,4,3,3,2,3,2,4,3, 3,2,3,3,4,3,3],
      sci8a8:  [4,4,3,3,3,2,3,4,4,3,3,2,4,3,2,3,3,2,3,3, 4,3,3,3,3,2,3],
      sci8a9:  [3,4,3,3,4,2,3,3,4,3,3,3,4,3,2,2,4,2,3,4, 3,2,4,3,3,3,3],
      sci8a10: [3,4,3,3,3,0,3,3,4,3,3,0,4,3,2,2,3,0,3,3, 3,3,3,2,3,0,3],
      sci8a11: [3,4,2,3,3,2,3,3,4,3,3,2,4,3,2,2,3,2,3,3, 3,2,4,3,3,2,3],
      sci8a12: [3,4,3,3,3,2,3,3,4,3,3,2,4,3,2,2,3,2,3,3, 3,3,4,2,3,2,3],
      sci8a13: [3,4,3,3,3,2,3,3,4,3,3,2,4,3,2,2,3,2,3,3, 3,2,3,3,4,3,3],
      sci8a14: [3,4,3,3,3,2,3,3,4,3,3,2,4,3,2,2,3,2,3,3, 2,3,4,3,3,2,3],
      sci8a15: [3,4,3,3,3,2,4,3,4,3,3,2,4,3,2,3,3,2,3,3, 3,2,3,3,3,3,4],
      sci8a16: [3,4,3,3,3,2,3,3,4,3,3,2,4,3,2,2,3,2,3,3, 3,3,4,2,3,2,3],
      sci8a17: [3,4,3,3,3,2,3,3,4,3,3,2,4,3,3,2,3,2,4,3, 3,2,3,3,4,3,3],
      sci8a18: [4,4,3,3,3,2,3,4,4,3,3,2,4,3,2,3,3,2,3,3, 4,3,3,3,3,2,3],
      sci8a19: [3,4,3,3,4,2,3,3,4,3,3,3,4,3,2,2,4,2,3,4, 3,2,4,3,3,3,3],
      sci8a20: [3,4,3,3,3,0,3,3,4,3,3,0,4,3,2,2,3,0,3,3, 3,3,3,0,3,0,3],
      // ── Science 8 Quiz Scores (points-based) ──
      sci8q1:  [8,10,6,8,9,5,7,9,10,8,7,5,10,8,6,5,7,4,8,7, 8,6,10,7,9,5,8],
      sci8q2:  [12,15,10,13,12,7,11,13,15,12,11,8,14,12,9,8,11,6,12,11, 13,9,14,10,13,8,12],
      sci8q3:  [7,10,6,8,8,5,7,8,10,7,7,5,9,7,6,5,8,4,7,7, 8,6,9,7,8,5,7],
      sci8q4:  [9,10,7,9,8,6,8,9,10,8,8,6,10,8,7,6,8,5,8,8, 9,7,10,8,9,6,8],
      sci8q5:  [8,10,7,8,8,5,7,8,10,8,7,5,10,7,6,5,7,4,8,8, 7,6,10,7,8,5,8],
      sci8q6:  [12,15,9,12,12,7,11,12,15,11,10,7,14,11,8,7,12,6,11,12, 12,9,14,10,12,7,11],
      sci8q7:  [7,10,6,8,7,4,7,8,10,8,7,5,9,7,5,5,7,4,7,7, 8,6,9,6,8,5,7],
      sci8q8:  [8,10,7,8,8,5,8,9,10,8,7,5,10,8,6,5,8,4,8,8, 8,7,10,7,8,5,8],
      sci8q9:  [8,10,7,9,8,5,8,9,10,8,8,6,10,8,6,5,7,4,8,8, 9,7,10,7,8,6,8],
      sci8q10: [12,15,10,12,13,7,11,12,15,12,11,8,14,12,9,7,12,6,13,12, 12,9,14,10,13,8,12],
      sci8q11: [8,10,7,8,8,5,7,8,10,8,7,0,10,8,6,5,7,0,8,8, 8,6,10,7,8,0,8],
      sci8q12: [8,10,7,8,8,0,7,8,10,8,7,0,10,8,6,5,7,0,8,8, 8,0,10,7,8,0,8],
      // ── Science 8 Unit Test Scores (points-based) ──
      sci8t1:  [48,57,36,50,49,31,42,50,58,48,44,30,56,47,33,30,44,28,48,46, 50,36,56,42,50,32,46],
      sci8t2:  [40,48,32,42,41,26,36,42,49,40,38,26,47,40,28,26,37,24,40,39, 42,32,47,35,42,27,39],
      sci8t3:  [41,48,33,43,41,27,37,43,49,41,38,26,47,40,28,25,38,24,41,40, 43,33,47,36,42,27,40],
      sci8t4:  [49,57,37,50,50,31,43,51,58,49,44,30,56,48,33,31,44,28,49,47, 50,0,56,43,50,0,47],
      sci8t5:  [65,76,53,67,67,42,57,68,77,65,59,0,75,64,44,42,58,0,65,62, 66,53,75,56,67,0,62]
    };
    saveScores('sci8', buildScores(STIDS, sci8Assessments, sci8ScoreMap));

    // Score-level notes (assignment-level comments)
    const sci8ScoreNotes = getScores('sci8');
    // Cece (st1) on Disease Research Poster
    (sci8ScoreNotes['st1']||[]).filter(e => e.assessmentId==='sci8a3').forEach(e => { e.note = 'Used three independent sources without prompting. Conclusion was thorough.'; });
    // Noor (st2) on Energy Transfer Investigation
    (sci8ScoreNotes['st2']||[]).filter(e => e.assessmentId==='sci8a8').forEach(e => { e.note = 'Extended the investigation by proposing a non-linear comparison. Exceptional experimental design.'; });
    // Sam (st3) on Cell Microscope Lab — early struggle
    (sci8ScoreNotes['st3']||[]).filter(e => e.assessmentId==='sci8a1').forEach(e => { e.note = 'Struggled with focusing the microscope initially but persisted and got clear images by end of class.'; });
    // Ethan (st6) on KMT Lab
    (sci8ScoreNotes['st6']||[]).filter(e => e.assessmentId==='sci8a4').forEach(e => { e.note = 'Worked hard on this but the conclusion doesn\'t connect back to the hypothesis.'; });
    // Priya (st9) on Plate Tectonics
    (sci8ScoreNotes['st9']||[]).filter(e => e.assessmentId==='sci8a5').forEach(e => { e.note = 'Exceptional group dynamics — facilitated discussion so everyone contributed equally.'; });
    // Amara (st13) on Ecosystem Essay
    (sci8ScoreNotes['st13']||[]).filter(e => e.assessmentId==='sci8a9').forEach(e => { e.note = 'Made a sophisticated connection between cellular respiration and carbon cycling in ecosystems.'; });
    // Tyler (st15) on Data Analysis
    (sci8ScoreNotes['st15']||[]).filter(e => e.assessmentId==='sci8a6').forEach(e => { e.note = 'Graph was accurate but analysis stayed surface-level. Needs to push into explaining WHY patterns exist.'; });
    // Fatima (st8) on Biodiversity Field Journal
    (sci8ScoreNotes['st8']||[]).filter(e => e.assessmentId==='sci8a18').forEach(e => { e.note = 'Identified 14 species with detailed sketches and habitat notes. Went well beyond expectations.'; });
    // Jas (st7) on Circuit Design Challenge
    (sci8ScoreNotes['st7']||[]).filter(e => e.assessmentId==='sci8a14').forEach(e => { e.note = 'Built a parallel circuit with dimmer switch — creative extension beyond the assignment requirements.'; });
    // Marcus (st12) on Chemical Reactions Lab
    (sci8ScoreNotes['st12']||[]).filter(e => e.assessmentId==='sci8a19').forEach(e => { e.note = 'Identified reaction types correctly but struggled writing balanced equations. Improving with practice.'; });
    // Liam (st4) on Water Quality Field Study
    (sci8ScoreNotes['st4']||[]).filter(e => e.assessmentId==='sci8a12').forEach(e => { e.note = 'Careful and methodical with the testing equipment. His pH readings were the most consistent in the class.'; });
    // Liam (st4) on Science Fair Proposal
    (sci8ScoreNotes['st4']||[]).filter(e => e.assessmentId==='sci8a20').forEach(e => { e.note = 'Chose to investigate water filtration methods — strong connection to the field study we did at Burnaby Lake.'; });
    // Mateo (st5) on Plate Tectonics Presentation
    (sci8ScoreNotes['st5']||[]).filter(e => e.assessmentId==='sci8a5').forEach(e => { e.note = 'Spoke confidently and answered audience questions well. Visual slides were clean and well-organized.'; });
    // Mateo (st5) on Climate Change Infographic
    (sci8ScoreNotes['st5']||[]).filter(e => e.assessmentId==='sci8a16').forEach(e => { e.note = 'Infographic was visually strong but the data sources were not cited properly. We talked about this.'; });
    // Ethan (st6) on Cell Microscope Lab
    (sci8ScoreNotes['st6']||[]).filter(e => e.assessmentId==='sci8a1').forEach(e => { e.note = 'Needed multiple reminders about lab safety procedures. Got there eventually but needs to be more independent.'; });
    // Jasper (st7) on Mineral Identification Lab
    (sci8ScoreNotes['st7']||[]).filter(e => e.assessmentId==='sci8a15').forEach(e => { e.note = 'Identified 11 of 12 minerals correctly. Really enjoyed this lab — asked if we could do more hands-on identification work.'; });
    // Fatima (st8) on Photosynthesis vs Respiration
    (sci8ScoreNotes['st8']||[]).filter(e => e.assessmentId==='sci8a11').forEach(e => { e.note = 'Diagram was beautifully detailed and scientifically accurate. Her comparison table was the best in the class.'; });
    // Jordan (st10) on Data Analysis Project
    (sci8ScoreNotes['st10']||[]).filter(e => e.assessmentId==='sci8a6').forEach(e => { e.note = 'Collected good data but the graph had scale issues. Came to tutorial to redo it — final version was solid.'; });
    // Jordan (st10) on Chemical Reactions Lab
    (sci8ScoreNotes['st10']||[]).filter(e => e.assessmentId==='sci8a19').forEach(e => { e.note = 'Strong lab technique this time. Balanced three of five equations independently — real progress since last term.'; });
    // Ines (st11) on Ecosystem Connections Essay
    (sci8ScoreNotes['st11']||[]).filter(e => e.assessmentId==='sci8a9').forEach(e => { e.note = 'Writing was clear and well-structured. Could have gone deeper on the cellular respiration connection.'; });
    // Ines (st11) on Disease Research Poster
    (sci8ScoreNotes['st11']||[]).filter(e => e.assessmentId==='sci8a3').forEach(e => { e.note = 'Chose malaria — her poster connected disease transmission to climate change. Impressed by the cross-topic thinking.'; });
    // Sofia (st14) on Energy Transfer Investigation
    (sci8ScoreNotes['st14']||[]).filter(e => e.assessmentId==='sci8a8').forEach(e => { e.note = 'Her calorimetry data was precise and she identified a systematic error in the setup that others missed.'; });
    // Aiden (st16) on Mid-Year Lab Skills Check
    (sci8ScoreNotes['st16']||[]).filter(e => e.assessmentId==='sci8a10').forEach(e => { e.note = 'Lab technique has improved a lot since September. Still rushes the cleanup but the actual investigation work is solid now.'; });
    // Aiden (st16) on Biodiversity Field Journal
    (sci8ScoreNotes['st16']||[]).filter(e => e.assessmentId==='sci8a18').forEach(e => { e.note = 'Only recorded 4 species. Entries were brief. He was more engaged with the outdoor component than the writing.'; });
    // Olivia (st17) on Climate Change Infographic
    (sci8ScoreNotes['st17']||[]).filter(e => e.assessmentId==='sci8a16').forEach(e => { e.note = 'Outstanding research depth. Used data from IPCC and local BC climate reports. Professional-quality design.'; });
    // Raj (st18) on Circuit Design Challenge
    (sci8ScoreNotes['st18']||[]).filter(e => e.assessmentId==='sci8a14').forEach(e => { e.note = 'Circuit didn\'t work initially — he debugged it systematically and found a loose connection. Good problem-solving process.'; });
    // Maya (st19) on Plate Tectonics Presentation
    (sci8ScoreNotes['st19']||[]).filter(e => e.assessmentId==='sci8a5').forEach(e => { e.note = 'Strong content knowledge but spoke very quietly during the presentation. We practised projecting voice afterward.'; });
    // Maya (st19) on Science Fair Proposal
    (sci8ScoreNotes['st19']||[]).filter(e => e.assessmentId==='sci8a20').forEach(e => { e.note = 'Proposal on plant growth under different light wavelengths — well-designed experiment with clear controls.'; });
    // Liv (st20) on Water Quality Field Study
    (sci8ScoreNotes['st20']||[]).filter(e => e.assessmentId==='sci8a12').forEach(e => { e.note = 'Took detailed field notes with habitat sketches. Her dissolved oxygen measurements were consistent and accurate.'; });
    // Hannah (st21) on Cell Microscope Lab
    (sci8ScoreNotes['st21']||[]).filter(e => e.assessmentId==='sci8a1').forEach(e => { e.note = 'Excellent technique from the start — helped two table partners with their microscope focusing.'; });
    // Hannah (st21) on Mineral Identification Lab
    (sci8ScoreNotes['st21']||[]).filter(e => e.assessmentId==='sci8a15').forEach(e => { e.note = 'Got all 12 minerals correct. Explained to her partner how to distinguish feldspar from quartz using cleavage.'; });
    // Darius (st22) on KMT & States of Matter Lab
    (sci8ScoreNotes['st22']||[]).filter(e => e.assessmentId==='sci8a4').forEach(e => { e.note = 'Heating curve was accurate. Asked a great question about why the temperature plateaus during phase changes.'; });
    // Mei (st23) on Disease Research Poster
    (sci8ScoreNotes['st23']||[]).filter(e => e.assessmentId==='sci8a3').forEach(e => { e.note = 'Chose tuberculosis. Research was thorough but the poster layout was hard to follow. We talked about visual hierarchy.'; });
    // Caleb (st24) on Data Analysis Project
    (sci8ScoreNotes['st24']||[]).filter(e => e.assessmentId==='sci8a6').forEach(e => { e.note = 'Collected solid data but the analysis section was just one paragraph. Needs to develop the "so what" part of his conclusions.'; });
    // Anisa (st25) on Ecosystem Connections Essay
    (sci8ScoreNotes['st25']||[]).filter(e => e.assessmentId==='sci8a9').forEach(e => { e.note = 'Beautiful writing. Made a connection between food webs and First Peoples seasonal harvesting practices that was genuinely insightful.'; });
    // Leo (st26) on Circuit Design Challenge
    (sci8ScoreNotes['st26']||[]).filter(e => e.assessmentId==='sci8a14').forEach(e => { e.note = 'Rushed through the design phase and his circuit failed. Rebuilt it with more care the next day — worked on the second attempt.'; });
    // Tessa (st27) on Chemical Reactions Lab
    (sci8ScoreNotes['st27']||[]).filter(e => e.assessmentId==='sci8a19').forEach(e => { e.note = 'Balanced all five equations independently and made the connection between reaction type and energy change. Asking extension questions.'; });
    // Tessa (st27) on Science Fair Proposal
    (sci8ScoreNotes['st27']||[]).filter(e => e.assessmentId==='sci8a20').forEach(e => { e.note = 'Proposing an investigation into microplastics in local waterways. Already started background research independently.'; });
    // Noor (st2) on Biodiversity Field Journal
    (sci8ScoreNotes['st2']||[]).filter(e => e.assessmentId==='sci8a18').forEach(e => { e.note = 'Recorded 16 species with detailed ecological notes. Her field sketches of lichen were gallery-worthy.'; });
    // Sam (st3) on Climate Change Infographic
    (sci8ScoreNotes['st3']||[]).filter(e => e.assessmentId==='sci8a16').forEach(e => { e.note = 'Focused on local BC impacts — pine beetle and wildfire data. Good use of regional context.'; });
    // Priya (st9) on Mineral Identification Lab
    (sci8ScoreNotes['st9']||[]).filter(e => e.assessmentId==='sci8a15').forEach(e => { e.note = 'Meticulous with the hardness tests. Correctly identified all 12 minerals and taught her table partner the streak test technique.'; });
    // Amara (st13) on Science Fair Proposal
    (sci8ScoreNotes['st13']||[]).filter(e => e.assessmentId==='sci8a20').forEach(e => { e.note = 'Proposing a study on the effect of music on plant growth. Hypothesis is testable and her materials list is thorough.'; });
    saveScores('sci8', sci8ScoreNotes);

    // Quick observations
    saveQuickObs('sci8', buildObs([
      { sid:'st1',  date:'2025-10-15', text:'Cece asked clarifying questions during the lab demo that showed she was thinking ahead about data collection.',                                 dims:['curiosity','engagement'],     sentiment:'strength', context:'whole-class' },
      { sid:'st1',  date:'2025-11-22', text:'Took initiative organizing her group\'s materials for the KMT lab without being asked.',                                                       dims:['selfRegulation','collaboration'], sentiment:'strength', context:'small-group' },
      { sid:'st1',  date:'2026-01-14', text:'Cece\'s quiz corrections showed she genuinely understood where she went wrong \u2014 not just fixing answers.',                                 dims:['resilience','selfRegulation'], sentiment:'strength', context:'independent' },
      { sid:'st1',  date:'2026-02-20', text:'Volunteered to share her energy transfer results with the class. Explained her reasoning clearly and fielded questions well.',                   dims:['engagement'],                 sentiment:'strength', context:'presentation' },
      { sid:'st2',  date:'2025-10-08', text:'Showed excellent leadership during the group lab \u2014 delegated tasks effectively and kept the team on track.',                               dims:['engagement','collaboration'], sentiment:'strength', context:'small-group' },
      { sid:'st2',  date:'2025-11-20', text:'Asked a thoughtful question about why cells need energy that led to a great class discussion.',                                                 dims:['curiosity'],                 sentiment:'strength', context:'whole-class' },
      { sid:'st2',  date:'2026-02-12', text:'Independently designed an alternative experimental setup when the first one failed. Impressive problem-solving.',                                dims:['resilience','curiosity'],     sentiment:'strength', context:'independent' },
      { sid:'st2',  date:'2026-03-10', text:'Noor mentored two classmates through the lab skills check. Her explanations are patient and technically precise.',                               dims:['collaboration','respect'],    sentiment:'strength', context:'small-group' },
      { sid:'st3',  date:'2025-10-10', text:'Struggled with the microscope technique but persisted through three attempts before asking for help. Growth mindset in action.',                 dims:['resilience'],                sentiment:'growth',   context:'independent' },
      { sid:'st3',  date:'2026-01-22', text:'Sam is starting to participate more in group discussions \u2014 offered two ideas during the brainstorm today.',                                 dims:['engagement','collaboration'], sentiment:'growth',   context:'small-group' },
      { sid:'st3',  date:'2025-11-14', text:'Sam worked steadily through the KMT particle diagrams. Accuracy improving noticeably since the cell unit.',                                     dims:['resilience','engagement'],    sentiment:'growth',   context:'independent' },
      { sid:'st3',  date:'2026-02-28', text:'Asked a thoughtful question connecting energy transfer to cooking \u2014 first time Sam has voluntarily spoken up in a whole-class setting.',    dims:['curiosity','engagement'],     sentiment:'growth',   context:'whole-class' },
      { sid:'st4',  date:'2025-12-11', text:'Explained the difference between elements and compounds to a peer using clear everyday analogies.',                                              dims:['collaboration','engagement'], sentiment:'strength', context:'small-group' },
      { sid:'st4',  date:'2025-10-20', text:'Liam\'s cell diagrams were detailed and accurately labelled. He takes pride in precision.',                                                      dims:['engagement'],                sentiment:'strength', context:'independent' },
      { sid:'st4',  date:'2026-01-22', text:'Helped set up lab equipment for the class without being asked. Reliable and thoughtful.',                                                        dims:['respect','selfRegulation'],   sentiment:'strength', context:'whole-class' },
      { sid:'st4',  date:'2026-03-05', text:'Liam\'s lab technique has become consistently strong. He double-checks measurements and records units carefully.',                               dims:['selfRegulation'],            sentiment:'strength', context:'independent' },
      { sid:'st5',  date:'2025-10-28', text:'Mateo took a creative risk with his poster layout \u2014 really effective visual communication of the immune response.',                         dims:['curiosity','engagement'],     sentiment:'strength', context:'independent' },
      { sid:'st5',  date:'2025-12-19', text:'Mateo\'s data analysis project showed strong graphing skills. He chose the right graph type and explained his reasoning.',                       dims:['engagement'],                sentiment:'strength', context:'independent' },
      { sid:'st5',  date:'2026-02-06', text:'Worked productively with a partner he doesn\'t usually choose. Showed flexibility and maturity.',                                                dims:['collaboration','respect'],    sentiment:'strength', context:'small-group' },
      { sid:'st5',  date:'2026-03-12', text:'Mateo\'s mid-year lab skills check was solid \u2014 he moved carefully and recorded data with attention to units and precision.',                dims:['selfRegulation'],            sentiment:'strength', context:'independent' },
      { sid:'st6',  date:'2025-11-18', text:'Needed a few reminders to stay on task during independent work time.',                                                                           dims:['selfRegulation'],            sentiment:'concern',  context:'independent' },
      { sid:'st6',  date:'2026-02-10', text:'Showed genuine excitement when the heating curve matched the prediction. Most engaged I\'ve seen him this term.',                                dims:['engagement','curiosity'],     sentiment:'growth',   context:'whole-class' },
      { sid:'st6',  date:'2025-10-31', text:'Ethan rushed through the poster without checking rubric criteria. Quality suffered because of pacing.',                                          dims:['selfRegulation'],            sentiment:'concern',  context:'independent' },
      { sid:'st6',  date:'2026-03-14', text:'Ethan completed the mid-year lab skills check with focus and care \u2014 a real shift from earlier in the year.',                                dims:['engagement','resilience'],    sentiment:'growth',   context:'independent' },
      { sid:'st7',  date:'2025-10-22', text:'Jas drew the most detailed and accurate cell diagram in the class. Real attention to scientific illustration.',                                  dims:['engagement'],                sentiment:'strength', context:'independent' },
      { sid:'st7',  date:'2025-12-05', text:'Contributed a creative visual to the plate tectonics group presentation that clearly communicated subduction zones.',                             dims:['curiosity','collaboration'],  sentiment:'strength', context:'small-group' },
      { sid:'st7',  date:'2026-01-20', text:'Jas quietly helps classmates with diagrams during work time. Natural peer supporter.',                                                           dims:['collaboration','respect'],    sentiment:'strength', context:'small-group' },
      { sid:'st7',  date:'2026-03-01', text:'His ecosystem essay included hand-drawn diagrams that were more effective than any digital version. Creative scientific communication.',          dims:['engagement','curiosity'],     sentiment:'strength', context:'independent' },
      { sid:'st8',  date:'2025-12-08', text:'Fatima independently looked up primary sources for her disease research poster. Self-directed learning at its best.',                            dims:['curiosity','selfRegulation'], sentiment:'strength', context:'independent' },
      { sid:'st8',  date:'2025-10-10', text:'Fatima was the first to get a clear microscope image and helped three classmates adjust their focus settings.',                                  dims:['collaboration','engagement'], sentiment:'strength', context:'small-group' },
      { sid:'st8',  date:'2026-01-16', text:'Strong performance on the atomic theory quiz. Her periodic table reading skills are well above grade level.',                                    dims:['engagement'],                sentiment:'strength', context:'independent' },
      { sid:'st8',  date:'2026-03-08', text:'Fatima asked a question about lab safety protocols that showed she\'d been reading ahead in the textbook. Always prepared.',                     dims:['curiosity','selfRegulation'], sentiment:'strength', context:'whole-class' },
      { sid:'st9',  date:'2025-12-05', text:'Presented tectonic plate research with real confidence \u2014 first time speaking to the whole class.',                                          dims:['engagement'],                sentiment:'strength', context:'presentation' },
      { sid:'st9',  date:'2026-01-28', text:'Connected plate tectonics to a news article she found about earthquakes in Japan. Brought in the article to share.',                             dims:['curiosity','engagement'],     sentiment:'strength', context:'whole-class' },
      { sid:'st9',  date:'2026-03-10', text:'Priya organized a peer study session before the lab skills check. She made sure struggling students felt comfortable asking questions.',         dims:['collaboration','respect'],    sentiment:'strength', context:'small-group' },
      { sid:'st10', date:'2025-10-20', text:'Jordan worked steadily through the cell lab, producing clean, well-labelled diagrams. Quiet but consistent effort.',                            dims:['engagement','selfRegulation'],sentiment:'strength', context:'independent' },
      { sid:'st10', date:'2025-12-05', text:'Took on the most technical part of the group presentation and delivered it clearly. Growing confidence.',                                         dims:['engagement','resilience'],    sentiment:'growth',   context:'presentation' },
      { sid:'st10', date:'2026-01-22', text:'Jordan asked for feedback on his quiz corrections before submitting. Shows initiative in seeking improvement.',                                   dims:['selfRegulation','resilience'],sentiment:'strength', context:'independent' },
      { sid:'st10', date:'2026-02-20', text:'Noticed an error in the class data set during the energy transfer lab and flagged it to the group. Good scientific thinking.',                   dims:['curiosity','engagement'],     sentiment:'strength', context:'small-group' },
      { sid:'st10', date:'2026-03-12', text:'Jordan\'s lab technique has become noticeably more confident this term. He moves with purpose and records data efficiently.',                    dims:['engagement'],                sentiment:'growth',   context:'independent' },
      { sid:'st11', date:'2025-11-05', text:'Ines collaborated well during the disease research, dividing tasks fairly and checking in with group members.',                                  dims:['collaboration'],             sentiment:'strength', context:'small-group' },
      { sid:'st11', date:'2025-12-19', text:'Her data analysis graphs were among the most accurate in the class. Strong attention to scale and labelling.',                                   dims:['engagement','selfRegulation'],sentiment:'strength', context:'independent' },
      { sid:'st11', date:'2026-01-28', text:'Ines asked a perceptive question about why certain elements are more reactive \u2014 showed she was connecting ideas across units.',              dims:['curiosity'],                 sentiment:'strength', context:'whole-class' },
      { sid:'st11', date:'2026-02-27', text:'Her ecosystem essay was well-structured with clear topic sentences. Solid scientific writing.',                                                   dims:['engagement'],                sentiment:'strength', context:'independent' },
      { sid:'st11', date:'2026-03-14', text:'Ines consistently follows safety procedures without reminders and helps peers remember theirs. Reliable lab partner.',                            dims:['selfRegulation','respect'],   sentiment:'strength', context:'small-group' },
      { sid:'st12', date:'2025-11-25', text:'Marcus struggled with the data analysis but kept trying \u2014 real improvement by end of class. Needs more practice with graph interpretation.',dims:['resilience'],                sentiment:'growth',   context:'independent' },
      { sid:'st12', date:'2025-10-17', text:'Marcus found the immune system quiz challenging but asked good questions afterward about what he got wrong.',                                     dims:['resilience','curiosity'],     sentiment:'growth',   context:'independent' },
      { sid:'st12', date:'2026-01-16', text:'Still mixing up elements and compounds, but he\'s using the periodic table more confidently now.',                                               dims:['resilience'],                sentiment:'growth',   context:'independent' },
      { sid:'st12', date:'2026-02-20', text:'Marcus volunteered to present his group\'s energy transfer findings. His explanation was clear even if the data was rough.',                      dims:['engagement','resilience'],    sentiment:'growth',   context:'presentation' },
      { sid:'st12', date:'2026-03-10', text:'Partnered with Noor for the lab skills check and showed improved technique. He\'s responding well to peer support.',                             dims:['collaboration','resilience'], sentiment:'growth',   context:'small-group' },
      { sid:'st13', date:'2025-10-14', text:'Led group discussion on vaccine research with confidence and clarity. Other students were visibly engaged.',                                      dims:['engagement','collaboration'], sentiment:'strength', context:'discussion' },
      { sid:'st13', date:'2026-02-27', text:'Made a sophisticated connection between cellular respiration and carbon cycling that I hadn\'t considered presenting. Shared it with the class.', dims:['curiosity','engagement'],    sentiment:'strength', context:'whole-class' },
      { sid:'st13', date:'2025-12-19', text:'Amara\'s data analysis project went beyond requirements \u2014 she calculated standard deviation and explained what it meant.',                  dims:['curiosity','engagement'],     sentiment:'strength', context:'independent' },
      { sid:'st14', date:'2025-10-17', text:'Sofia did well on the immune system quiz and helped a classmate review her mistakes afterward.',                                                  dims:['collaboration','engagement'], sentiment:'strength', context:'small-group' },
      { sid:'st14', date:'2025-12-05', text:'Her plate tectonics presentation section was well-researched and clearly delivered. She\'s a confident speaker.',                                 dims:['engagement'],                sentiment:'strength', context:'presentation' },
      { sid:'st14', date:'2026-01-20', text:'Sofia noticed a pattern in the periodic table that I hadn\'t highlighted yet \u2014 asked about it during class discussion.',                    dims:['curiosity'],                 sentiment:'strength', context:'whole-class' },
      { sid:'st14', date:'2026-02-15', text:'Completed the energy transfer lab efficiently and helped clean up the lab station thoroughly. Always dependable.',                               dims:['selfRegulation','respect'],   sentiment:'strength', context:'independent' },
      { sid:'st14', date:'2026-03-14', text:'Sofia\'s lab skills check was solid across all criteria. Consistent, reliable student.',                                                          dims:['engagement','selfRegulation'],sentiment:'strength', context:'independent' },
      { sid:'st15', date:'2026-01-20', text:'Tyler is showing more willingness to revise work after feedback. Rewrote his conclusion without being asked.',                                    dims:['resilience','selfRegulation'],sentiment:'growth',   context:'independent' },
      { sid:'st15', date:'2025-11-14', text:'Tyler was off-task for much of the KMT lab. We had a conversation about what\'s getting in the way.',                                           dims:['selfRegulation'],            sentiment:'concern',  context:'independent' },
      { sid:'st15', date:'2026-02-27', text:'Tyler\'s ecosystem essay showed he can write with depth when the topic interests him. His paragraph on food webs was strong.',                   dims:['engagement','curiosity'],     sentiment:'growth',   context:'independent' },
      { sid:'st16', date:'2026-02-18', text:'Aiden respectfully challenged a group member\'s data interpretation with evidence. Good scientific discourse.',                                   dims:['respect','curiosity'],        sentiment:'strength', context:'discussion' },
      { sid:'st16', date:'2025-11-14', text:'Aiden needs support staying focused during longer lab activities. Works better with a structured checklist.',                                     dims:['selfRegulation'],            sentiment:'concern',  context:'independent' },
      { sid:'st16', date:'2026-01-16', text:'Showed improvement on the atomic theory quiz compared to earlier assessments. He\'s putting in effort outside of class.',                        dims:['resilience','engagement'],    sentiment:'growth',   context:'independent' },
      { sid:'st16', date:'2026-03-05', text:'Aiden peer-reviewed a classmate\'s lab report and gave specific, constructive feedback. Surprising maturity.',                                    dims:['collaboration','respect'],    sentiment:'strength', context:'small-group' },
      { sid:'st17', date:'2025-11-05', text:'Olivia asked an incredible "what if" question about plate boundaries and ocean formation that pushed the whole class\'s thinking.',               dims:['curiosity'],                 sentiment:'strength', context:'whole-class' },
      { sid:'st17', date:'2025-12-19', text:'Olivia\'s data analysis project was thorough and well-organized. Her graphs communicated the story clearly.',                                     dims:['engagement','selfRegulation'],sentiment:'strength', context:'independent' },
      { sid:'st17', date:'2026-02-06', text:'Made an insightful connection between energy transfer and climate change during the lab debrief.',                                                dims:['curiosity','engagement'],     sentiment:'strength', context:'whole-class' },
      { sid:'st17', date:'2026-03-12', text:'Olivia volunteered to demonstrate proper pipetting technique for the class. Clear and confident.',                                               dims:['engagement','collaboration'], sentiment:'strength', context:'whole-class' },
      { sid:'st18', date:'2025-11-14', text:'Raj completed the KMT lab but his particle diagrams lacked detail. Needs to slow down and label more carefully.',                                dims:['selfRegulation'],            sentiment:'concern',  context:'independent' },
      { sid:'st18', date:'2026-01-16', text:'Raj struggled with the atomic theory quiz but came in at lunch to review his mistakes. That initiative matters.',                                 dims:['resilience'],                sentiment:'growth',   context:'independent' },
      { sid:'st18', date:'2026-02-06', text:'Raj worked more carefully during the energy transfer lab today. He checked measurements twice before recording. Progress.',                       dims:['selfRegulation','resilience'],sentiment:'growth',   context:'independent' },
      { sid:'st18', date:'2026-03-05', text:'Asked for a checklist to help him stay on track during independent work. Good self-awareness about what he needs.',                               dims:['selfRegulation'],            sentiment:'growth',   context:'independent' },
      { sid:'st18', date:'2025-12-19', text:'Raj contributed useful ideas to his group during the data analysis project, especially around choosing graph types.',                              dims:['collaboration','engagement'], sentiment:'strength', context:'small-group' },
      { sid:'st19', date:'2026-03-05', text:'Maya offered to tutor during lunch \u2014 genuinely wants her peers to succeed. Spent 30 minutes helping two classmates with lab reports.',       dims:['collaboration','respect'],    sentiment:'strength', context:'small-group' },
      { sid:'st19', date:'2025-10-31', text:'Maya\'s disease research poster was visually clear and scientifically accurate. Strong all-around work.',                                         dims:['engagement'],                sentiment:'strength', context:'independent' },
      { sid:'st19', date:'2025-12-19', text:'Maya asked thoughtful questions during the data analysis debrief that showed she was thinking critically about her results.',                     dims:['curiosity','engagement'],     sentiment:'strength', context:'whole-class' },
      { sid:'st19', date:'2026-02-06', text:'Maya worked patiently with a partner who needed extra support during the energy transfer lab. Natural teacher.',                                  dims:['collaboration','respect'],    sentiment:'strength', context:'small-group' },
      { sid:'st20', date:'2025-12-15', text:'Liv revised her lab conclusion after feedback without being asked. Shows strong self-regulation.',                                                dims:['resilience','selfRegulation'],sentiment:'strength', context:'independent' },
      { sid:'st20', date:'2025-10-17', text:'Liv aced the immune system quiz and stayed behind to explain the difference between innate and adaptive immunity to a classmate.',                dims:['collaboration','engagement'], sentiment:'strength', context:'small-group' },
      { sid:'st20', date:'2026-01-22', text:'Liv\'s atomic theory quiz corrections were detailed and showed real understanding of where she went wrong.',                                      dims:['selfRegulation','resilience'],sentiment:'strength', context:'independent' },
      { sid:'st20', date:'2026-03-05', text:'Completed the ecosystem essay early and used the extra time to add a diagram that strengthened her argument. Self-directed.',                     dims:['selfRegulation','engagement'],sentiment:'strength', context:'independent' },
      { sid:'st21', date:'2025-10-15', text:'Hannah asked thoughtful questions during the microscope lab. She wanted to understand WHY the cells looked different, not just identify them.',   dims:['curiosity','engagement'],     sentiment:'strength', context:'whole-class' },
      { sid:'st21', date:'2025-12-05', text:'Hannah\'s plate tectonics presentation was well-organized and delivered with growing confidence.',                                                dims:['engagement'],                sentiment:'strength', context:'presentation' },
      { sid:'st21', date:'2026-01-20', text:'Worked quietly but productively through the atomic theory material. Completed all practice problems accurately.',                                 dims:['selfRegulation','engagement'],sentiment:'strength', context:'independent' },
      { sid:'st21', date:'2026-02-20', text:'Hannah volunteered to explain the energy transfer concept to her lab group using a whiteboard diagram. Clear communication.',                     dims:['collaboration','engagement'], sentiment:'strength', context:'small-group' },
      { sid:'st21', date:'2026-03-10', text:'Hannah\'s ecosystem essay showed strong analytical thinking \u2014 she connected multiple concepts across units.',                               dims:['curiosity'],                 sentiment:'strength', context:'independent' },
      { sid:'st22', date:'2025-10-17', text:'Darius found the immune system quiz difficult but stayed focused and attempted every question. Doesn\'t give up easily.',                        dims:['resilience'],                sentiment:'growth',   context:'independent' },
      { sid:'st22', date:'2025-12-05', text:'Darius was quiet during the group presentation but his research notes were the most detailed in the group.',                                      dims:['engagement'],                sentiment:'strength', context:'small-group' },
      { sid:'st22', date:'2026-01-16', text:'Still finding the chemistry content challenging but he\'s coming to tutorials and asking targeted questions. Real effort.',                       dims:['resilience','selfRegulation'],sentiment:'growth',   context:'independent' },
      { sid:'st22', date:'2026-02-20', text:'Darius made a connection between energy transfer and cooking that showed practical understanding of the concept.',                                dims:['curiosity'],                 sentiment:'strength', context:'whole-class' },
      { sid:'st22', date:'2026-03-14', text:'Darius\'s lab technique has improved significantly \u2014 he measures carefully now and records data in an organized table.',                     dims:['selfRegulation','resilience'],sentiment:'growth',   context:'independent' },
      { sid:'st23', date:'2025-10-03', text:'Mei\'s microscope work was exceptional \u2014 she found and sketched cell structures that other students missed entirely.',                       dims:['engagement','curiosity'],     sentiment:'strength', context:'independent' },
      { sid:'st23', date:'2025-11-14', text:'Mei\'s KMT particle diagrams were the most scientifically accurate in the class. Real precision.',                                               dims:['engagement'],                sentiment:'strength', context:'independent' },
      { sid:'st23', date:'2026-01-16', text:'Scored highest in the class on the atomic theory quiz. She studies independently and it shows.',                                                  dims:['selfRegulation','engagement'],sentiment:'strength', context:'independent' },
      { sid:'st23', date:'2026-02-27', text:'Mei\'s ecosystem essay connected Indigenous land management practices to ecological concepts. Thoughtful and well-researched.',                   dims:['curiosity','respect'],        sentiment:'strength', context:'independent' },
      { sid:'st23', date:'2026-03-14', text:'Mei helped calibrate the equipment during the lab skills check and explained the process to two classmates. Natural leader in the lab.',          dims:['collaboration','engagement'], sentiment:'strength', context:'small-group' },
      { sid:'st24', date:'2025-10-31', text:'Caleb\'s disease research poster was solid but he relied too heavily on one source. We discussed broadening his research.',                       dims:['selfRegulation'],            sentiment:'concern',  context:'independent' },
      { sid:'st24', date:'2025-12-19', text:'Caleb\'s data analysis graphs were accurate but his written analysis was thin. He can interpret data verbally better than in writing.',           dims:['engagement'],                sentiment:'growth',   context:'independent' },
      { sid:'st24', date:'2026-01-22', text:'Caleb asked a great question about why noble gases don\'t react. Led to a productive class discussion.',                                         dims:['curiosity','engagement'],     sentiment:'strength', context:'whole-class' },
      { sid:'st24', date:'2026-02-15', text:'Worked well with his energy transfer lab partner \u2014 took turns recording data and both contributed to the conclusion.',                      dims:['collaboration'],             sentiment:'strength', context:'small-group' },
      { sid:'st24', date:'2026-03-14', text:'Caleb\'s lab skills have steadily improved. He\'s more careful with measurements and his technique is becoming reliable.',                        dims:['resilience','selfRegulation'],sentiment:'growth',   context:'independent' },
      { sid:'st25', date:'2025-10-14', text:'Anisa brought in a news article about antibiotic resistance that connected perfectly to our immune system unit. Great initiative.',               dims:['curiosity','engagement'],     sentiment:'strength', context:'whole-class' },
      { sid:'st25', date:'2025-12-05', text:'Anisa\'s plate tectonics presentation was the most polished in her group. She rehearsed and it showed.',                                          dims:['engagement','selfRegulation'],sentiment:'strength', context:'presentation' },
      { sid:'st25', date:'2026-01-28', text:'Anisa helped organize a peer study group for the atomic theory quiz. Other students appreciated her leadership.',                                 dims:['collaboration','respect'],    sentiment:'strength', context:'small-group' },
      { sid:'st25', date:'2026-02-27', text:'Her ecosystem essay was one of the strongest in the class \u2014 clear thesis, strong evidence, thoughtful conclusion.',                         dims:['engagement'],                sentiment:'strength', context:'independent' },
      { sid:'st25', date:'2026-03-14', text:'Anisa\'s lab technique is consistently precise. She models good practice for the students around her.',                                           dims:['selfRegulation','engagement'],sentiment:'strength', context:'independent' },
      { sid:'st26', date:'2025-10-17', text:'Leo found the immune system quiz challenging. He tends to rush through questions without reading them carefully.',                                dims:['selfRegulation'],            sentiment:'concern',  context:'independent' },
      { sid:'st26', date:'2025-12-05', text:'Leo contributed well to the plate tectonics group presentation when given a specific, concrete task.',                                             dims:['collaboration','engagement'], sentiment:'growth',   context:'small-group' },
      { sid:'st26', date:'2026-01-22', text:'Leo is starting to ask for help earlier instead of struggling silently. He came to tutorial and made real progress.',                             dims:['resilience','selfRegulation'],sentiment:'growth',   context:'independent' },
      { sid:'st26', date:'2026-02-20', text:'Leo\'s energy transfer lab data was more accurate than previous labs. He\'s slowing down and being more careful.',                                dims:['selfRegulation','resilience'],sentiment:'growth',   context:'independent' },
      { sid:'st26', date:'2026-03-10', text:'Leo helped clean up the lab without being asked and made sure all equipment was stored correctly. Showing more responsibility.',                  dims:['respect','selfRegulation'],   sentiment:'growth',   context:'whole-class' },
      { sid:'st27', date:'2025-10-31', text:'Tessa\'s disease research poster was thorough and well-designed. She went beyond the rubric requirements.',                                       dims:['engagement','curiosity'],     sentiment:'strength', context:'independent' },
      { sid:'st27', date:'2025-12-19', text:'Tessa\'s data analysis project included a creative comparison of two different data sets. She saw a pattern no one else noticed.',                dims:['curiosity','engagement'],     sentiment:'strength', context:'independent' },
      { sid:'st27', date:'2026-01-28', text:'Tessa asked a question during the atomic theory lesson that showed she was already thinking about chemical bonding. Ahead of the curve.',        dims:['curiosity'],                 sentiment:'strength', context:'whole-class' },
      { sid:'st27', date:'2026-02-27', text:'Her ecosystem essay was beautifully written with strong scientific vocabulary. Tessa communicates science effectively.',                           dims:['engagement'],                sentiment:'strength', context:'independent' },
      { sid:'st27', date:'2026-03-14', text:'Tessa volunteered to demonstrate lab safety procedures for the class. She\'s becoming a real leader in the lab.',                                 dims:['engagement','collaboration'], sentiment:'strength', context:'whole-class' }
    ]));

    // Term ratings
    const sci8TR = {};
    sci8TR['st1']  = { 'term-1': { dims:{engagement:4, collaboration:3, selfRegulation:4, resilience:3, curiosity:3, respect:4}, narrative:'Cece is a consistent, dependable student who takes care with her lab work and asks clarifying questions. She would benefit from taking more risks in class discussions and sharing her ideas more freely.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:4, curiosity:4, respect:4}, narrative:'Cece has grown noticeably more confident this term. She volunteers to present, helps organize group work, and her written analysis has become more detailed and evidence-based.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st2']  = { 'term-1': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:4, curiosity:4, respect:4}, narrative:'Noor brings exceptional curiosity and scientific thinking to every investigation. She consistently extends experiments beyond requirements, asks questions that deepen class understanding, and models outstanding lab technique.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:4, curiosity:4, respect:4}, narrative:'Noor continues to set the standard. This term she has taken on more of a mentoring role, guiding classmates through labs with patience and precision. Her scientific writing has become remarkably polished.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st3']  = { 'term-1': { dims:{engagement:2, collaboration:2, selfRegulation:3, resilience:3, curiosity:3, respect:4}, narrative:'Sam is building confidence slowly but surely. They struggled early with lab technique but showed real persistence. Sam works best in smaller group settings and is beginning to share ideas more openly.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:3, collaboration:3, selfRegulation:3, resilience:4, curiosity:3, respect:4}, narrative:'Sam has made meaningful progress this term. They participate more in group discussions, ask questions in class, and their written work has improved in both depth and accuracy. The growth is real.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st4']  = { 'term-1': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:3, curiosity:3, respect:4}, narrative:'Liam is a reliable, detail-oriented student who produces consistently solid work. He explains concepts clearly to peers and takes pride in precision. He could push himself further by exploring questions beyond the curriculum.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:4, curiosity:4, respect:4}, narrative:'Liam continues to be a steady, thoughtful contributor. His lab technique is now among the best in the class, and he has started asking deeper questions about the science behind procedures. A pleasure to teach.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st5']  = { 'term-1': { dims:{engagement:4, collaboration:3, selfRegulation:3, resilience:3, curiosity:4, respect:3}, narrative:'Mateo brings creative energy to science. His poster work showed real visual communication skills, and he takes risks with unconventional approaches. He would benefit from more careful data recording in labs.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:3, curiosity:4, respect:4}, narrative:'Mateo has become more methodical in his lab work this term while maintaining his creative strengths. He works well with a wider range of partners and his data recording has improved significantly.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st6']  = { 'term-1': { dims:{engagement:2, collaboration:3, selfRegulation:2, resilience:3, curiosity:3, respect:3}, narrative:'Ethan shows growing resilience in science, particularly during labs where he can engage hands-on. He persists through difficulty and is learning to ask for help earlier. His curiosity in class discussions is genuine \u2014 he benefits from channeling that energy into his written analysis.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:3, collaboration:3, selfRegulation:3, resilience:3, curiosity:3, respect:3}, narrative:'Ethan showed real improvement in Term 2, especially in the energy transfer unit where his excitement was visible. His lab skills check was his strongest assessment yet. He is learning to stay focused during independent work, though this remains an area for growth.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st7']  = { 'term-1': { dims:{engagement:4, collaboration:3, selfRegulation:4, resilience:3, curiosity:4, respect:4}, narrative:'Jas has a gift for scientific illustration and visual communication. His diagrams are consistently the most detailed and accurate in the class. He quietly supports classmates and produces high-quality independent work.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:3, curiosity:4, respect:4}, narrative:'Jas continues to excel in visual and hands-on science. This term he has stepped up as a peer helper, sharing his illustration skills with classmates. His ecosystem essay included original diagrams that were genuinely impressive.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st8']  = { 'term-1': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:3, curiosity:4, respect:4}, narrative:'Fatima is a self-directed learner who consistently goes beyond what is asked. She researches independently, prepares for labs thoroughly, and supports her peers generously. Her scientific curiosity is genuine and contagious.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:4, curiosity:4, respect:4}, narrative:'Fatima has taken her self-directed learning to the next level this term. She reads ahead, asks questions that push the class, and her lab preparation is exemplary. She has also become a more confident collaborator.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st9']  = { 'term-1': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:3, curiosity:4, respect:4}, narrative:'Priya combines strong observation skills with genuine care for her classmates\' learning. Her presentations have become a class highlight, and she regularly connects science to current events. A real leader in the lab.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:4, curiosity:4, respect:4}, narrative:'Priya has grown into a true scientific leader this term. She organized peer study sessions, connected energy concepts to real-world news, and her lab skills are now among the strongest in the class. A model student.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st10'] = { 'term-1': { dims:{engagement:3, collaboration:3, selfRegulation:3, resilience:3, curiosity:3, respect:4}, narrative:'Jordan works quietly and consistently. He produces accurate work and follows instructions carefully. He is beginning to show more initiative, like volunteering for the group presentation, but could push himself to share his thinking more often.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:3, selfRegulation:4, resilience:4, curiosity:4, respect:4}, narrative:'Jordan has shown real growth this term. He caught a data error during the energy transfer lab, asked for feedback proactively on his quiz corrections, and his confidence in lab settings has improved noticeably. Keep pushing, Jordan.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st11'] = { 'term-1': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:3, curiosity:3, respect:4}, narrative:'Ines is a collaborative, organized student who contributes reliably to group work and produces accurate independent work. Her data analysis skills are strong. She could develop further by asking more questions and exploring her own scientific curiosity.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:3, curiosity:4, respect:4}, narrative:'Ines has started asking more probing questions this term and her curiosity is showing in her written work. She remains a reliable lab partner and her safety awareness is exemplary. Her ecosystem essay was well-structured and analytically strong.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st12'] = { 'term-1': { dims:{engagement:2, collaboration:3, selfRegulation:2, resilience:3, curiosity:2, respect:3}, narrative:'Marcus finds some of the content challenging but shows real persistence. He keeps trying even when frustrated and has started asking for help earlier. His resilience is a genuine strength. He needs continued support with graph interpretation and data analysis.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:3, collaboration:3, selfRegulation:3, resilience:4, curiosity:3, respect:3}, narrative:'Marcus has shown encouraging growth. He volunteered to present, improved his technique with peer support, and his quiz corrections show he is learning from his mistakes. His resilience is becoming a real asset.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st13'] = { 'term-1': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:4, curiosity:4, respect:4}, narrative:'Amara is a standout scientific thinker. She makes connections across units that surprise me, leads group work with warmth and clarity, and consistently produces evidence-based conclusions. She sets the standard for the class.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:4, curiosity:4, respect:4}, narrative:'Amara continues to be exceptional. Her ecosystem essay connected cellular respiration to carbon cycling in a way I will use as an exemplar. She leads without dominating and supports without doing the work for others. Truly outstanding.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st14'] = { 'term-1': { dims:{engagement:4, collaboration:3, selfRegulation:4, resilience:3, curiosity:3, respect:4}, narrative:'Sofia is a confident, capable student who produces consistently strong work. Her presentation skills are excellent and she notices patterns that others miss. She could push further by exploring connections between science and other disciplines.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:3, curiosity:4, respect:4}, narrative:'Sofia has broadened her engagement this term, asking questions about the periodic table that showed independent thinking and helping clean up lab stations regularly. Her lab skills check was solid across all criteria. Dependable and growing.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st15'] = { 'term-1': { dims:{engagement:2, collaboration:2, selfRegulation:2, resilience:3, curiosity:2, respect:3}, narrative:'Tyler has the ability to do well in science but often needs prompting to engage fully. When he focuses, his work shows real understanding. His revision of the data analysis project after feedback was encouraging \u2014 more of that self-direction will make a big difference.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:3, collaboration:2, selfRegulation:3, resilience:3, curiosity:3, respect:3}, narrative:'Tyler has shown improvement this term, particularly when topics interest him. His ecosystem essay paragraph on food webs was genuinely strong. He is starting to revise work after feedback without being asked, which is a positive shift.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st16'] = { 'term-1': { dims:{engagement:2, collaboration:3, selfRegulation:2, resilience:2, curiosity:3, respect:3}, narrative:'Aiden can be engaged and curious when topics catch his interest, but he struggles to maintain focus during longer independent tasks. He benefits from structured checklists and clear expectations. His curiosity in discussion is genuine.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:3, collaboration:3, selfRegulation:3, resilience:3, curiosity:3, respect:4}, narrative:'Aiden has shown notable growth in self-regulation. He peer-reviewed a classmate\'s work thoughtfully, challenged data interpretations with evidence, and his quiz scores have improved. He is learning to channel his energy productively.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st17'] = { 'term-1': { dims:{engagement:4, collaboration:3, selfRegulation:4, resilience:3, curiosity:4, respect:4}, narrative:'Olivia asks questions that push the whole class\'s thinking. Her curiosity is exceptional and she makes connections that show deep engagement with the material. Her data analysis project was thorough and well-organized.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:3, curiosity:4, respect:4}, narrative:'Olivia continues to drive class discussions with insightful questions. This term she has also stepped into more collaborative roles, volunteering to demonstrate techniques and connecting energy concepts to climate change. A scientific thinker.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st18'] = { 'term-1': { dims:{engagement:2, collaboration:3, selfRegulation:2, resilience:3, curiosity:2, respect:3}, narrative:'Raj finds some science content challenging and tends to rush through work without attention to detail. He contributes to group work and has useful ideas, but his individual output needs more care and precision. He would benefit from slowing down and using checklists.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:3, collaboration:3, selfRegulation:3, resilience:3, curiosity:3, respect:3}, narrative:'Raj has shown real improvement in self-regulation this term. He came to tutorial voluntarily, asked for a checklist to stay on track, and his lab data accuracy has improved. He is learning to slow down and take care with his work. Encouraging progress.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st19'] = { 'term-1': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:3, curiosity:4, respect:4}, narrative:'Maya is a generous, thoughtful student who consistently supports her peers. Her disease research poster was strong and her collaborative spirit makes every group she joins more productive. She is a quiet leader.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:3, curiosity:4, respect:4}, narrative:'Maya\'s generosity and patience with classmates is remarkable. She tutors at lunch, helps struggling students during labs, and her own work remains consistently strong. She asks critical questions during debriefs that show she thinks deeply about science.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st20'] = { 'term-1': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:4, curiosity:3, respect:4}, narrative:'Liv is a strong, self-directed student who revises her work proactively and produces consistently accurate results. She helps peers without being asked and her self-regulation is excellent. She could push herself further by exploring her own scientific questions.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:4, curiosity:4, respect:4}, narrative:'Liv has maintained her high standards and added more depth to her written analysis this term. Her ecosystem essay was completed early with extra diagrams, and her quiz corrections show genuine metacognitive skill. A consistently excellent student.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st21'] = { 'term-1': { dims:{engagement:4, collaboration:3, selfRegulation:4, resilience:3, curiosity:4, respect:4}, narrative:'Hannah is a thoughtful student who asks genuine questions and works carefully through lab activities. She is quiet but engaged, and her work shows real understanding of the content.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:3, curiosity:4, respect:4}, narrative:'Hannah has become more willing to share her ideas this term. She volunteered to explain concepts to her lab group and her written analysis connects ideas across units. Growing into a confident science student.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st22'] = { 'term-1': { dims:{engagement:2, collaboration:3, selfRegulation:2, resilience:3, curiosity:2, respect:3}, narrative:'Darius finds the written and theoretical aspects of science challenging. He works hard when engaged, especially in labs, and his resilience during difficult tasks is genuine. He benefits from structured support and visual models.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:3, collaboration:3, selfRegulation:3, resilience:4, curiosity:3, respect:3}, narrative:'Darius has shown real improvement in Term 2. He attends tutorials, asks targeted questions, and his lab technique has become more precise. He made a practical connection between energy transfer and cooking that showed genuine understanding.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st23'] = { 'term-1': { dims:{engagement:4, collaboration:3, selfRegulation:4, resilience:3, curiosity:4, respect:4}, narrative:'Mei is one of the strongest science students in the class. Her lab work is exceptionally precise, her understanding of content is deep, and she studies independently. She could develop further by sharing her expertise more actively with peers.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:4, curiosity:4, respect:4}, narrative:'Mei has begun sharing her skills more openly, helping calibrate equipment and explaining processes to classmates. Her ecosystem essay incorporated Indigenous perspectives on land management \u2014 thoughtful and well-researched. An exceptional student who is becoming a stronger collaborator.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st24'] = { 'term-1': { dims:{engagement:3, collaboration:3, selfRegulation:3, resilience:3, curiosity:3, respect:3}, narrative:'Caleb produces solid work but tends to rely on a single source and rushes through written analysis. He can interpret data well verbally but struggles to translate that into written form. He asks good questions when curious.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:3, collaboration:3, selfRegulation:3, resilience:3, curiosity:4, respect:3}, narrative:'Caleb has steadily improved his lab technique and is asking more questions in class. His question about noble gases sparked a productive discussion. His written analysis still needs more depth, but his data collection accuracy has improved.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st25'] = { 'term-1': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:3, curiosity:4, respect:4}, narrative:'Anisa is a proactive, well-organized student who brings relevant current events to class and helps organize peer study groups. Her presentations are polished and she takes pride in doing quality work.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:4, curiosity:4, respect:4}, narrative:'Anisa continues to be a leader in the class. Her ecosystem essay was among the strongest submitted, and her lab technique is consistently precise. She organized a peer study group before the atomic theory quiz that other students found genuinely helpful.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st26'] = { 'term-1': { dims:{engagement:2, collaboration:3, selfRegulation:2, resilience:2, curiosity:2, respect:3}, narrative:'Leo tends to rush through tasks and finds sustained focus challenging. He works better with concrete, structured tasks and clear expectations. He contributes to group work when given a specific role but needs support staying on track independently.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:3, collaboration:3, selfRegulation:3, resilience:3, curiosity:3, respect:3}, narrative:'Leo has shown growth this term in self-regulation. He asked for help earlier, came to tutorial, and his lab data accuracy has improved. He also started cleaning up lab stations without being asked \u2014 a small but meaningful shift in responsibility.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    sci8TR['st27'] = { 'term-1': { dims:{engagement:4, collaboration:3, selfRegulation:4, resilience:3, curiosity:4, respect:4}, narrative:'Tessa is a strong, curious student who goes beyond the rubric requirements. Her disease research poster was thorough and her data analysis project included creative comparisons. She communicates science effectively in writing.', created:new Date('2025-12-20').toISOString(), modified:new Date('2025-12-20').toISOString() }, 'term-2': { dims:{engagement:4, collaboration:4, selfRegulation:4, resilience:3, curiosity:4, respect:4}, narrative:'Tessa has stepped into a leadership role this term, volunteering to demonstrate safety procedures and asking questions that show she is thinking ahead of the curriculum. Her written work is consistently strong and her scientific vocabulary is impressive.', created:new Date('2026-03-20').toISOString(), modified:new Date('2026-03-20').toISOString() } };
    saveTermRatings('sci8', sci8TR);
  }


  // ── Migrate old gb-notes into gb-quick-obs (one-time) ──
  Object.keys(COURSES).forEach(cid => {
    const oldNotes = getNotes(cid);
    const hasOld = Object.keys(oldNotes).some(sid => (oldNotes[sid]||[]).length > 0);
    if (hasOld) {
      const obs = getQuickObs(cid);
      Object.keys(oldNotes).forEach(sid => {
        if (!obs[sid]) obs[sid] = [];
        const existingIds = new Set(obs[sid].map(o => o.id));
        (oldNotes[sid]||[]).forEach(n => {
          if (!existingIds.has(n.id)) {
            obs[sid].push({
              id: n.id, text: n.text, dims: [],
              created: n.created || new Date().toISOString(),
              date: (n.created || '').slice(0,10) || getTodayStr()
            });
          }
        });
      });
      saveQuickObs(cid, obs);
      localStorage.removeItem('gb-notes-' + cid);
    }
  });
  return _didSeed;
}
