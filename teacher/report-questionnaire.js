/* report-questionnaire.js — Term questionnaire + narrative generator (extracted from page-reports.js) */
window.ReportQuestionnaire = (function () {
  'use strict';

  /* ── Parent state injection ──────────────────────────────── */
  var _activeCourse = null;
  var _renderReports = null;
  var _tqIncludeAssignFeedback = true;
  var _tqObsFilter = 'all';
  var _SHOW_AUTO_NARRATIVE = false;

  function configure(opts) {
    _activeCourse = opts.activeCourse;
    _renderReports = opts.renderReports;
    if (opts.tqIncludeAssignFeedback !== undefined) _tqIncludeAssignFeedback = opts.tqIncludeAssignFeedback;
    if (opts.tqObsFilter !== undefined) _tqObsFilter = opts.tqObsFilter;
  }
  function getActiveCourseLocal() {
    return _activeCourse;
  }
  function rerender() {
    if (_renderReports) _renderReports();
  }

  /* ── Imports from sibling modules ──────────────────────── */
  var getTermId = ReportBlocks.getTermId;
  var getPronouns = ReportBlocks.getPronouns;
  var OBS_DESCRIPTORS = ReportBlocks.OBS_DESCRIPTORS;

  var tqStudentIndex = 0;

  function getTqStudents() {
    return sortStudents(getStudents(_activeCourse), 'lastName');
  }

  function tqPrevStudent() {
    tqSaveCurrentIfNeeded();
    tqStudentIndex = Math.max(0, tqStudentIndex - 1);
    rerender();
  }
  function tqNextStudent() {
    tqSaveCurrentIfNeeded();
    const students = getTqStudents();
    if (tqStudentIndex >= students.length - 1) {
      switchTab('progress');
      return;
    }
    tqStudentIndex = Math.min(students.length - 1, tqStudentIndex + 1);
    rerender();
  }

  function tqSaveCurrentIfNeeded() {
    const students = getTqStudents();
    if (!students[tqStudentIndex]) return;
    const sid = students[tqStudentIndex].id;
    const termId = getTermId();
    const existing = getStudentTermRating(_activeCourse, sid, termId);
    const el = document.getElementById('tq-narrative');
    if (el && existing) {
      upsertTermRating(_activeCourse, sid, termId, { narrative: sanitizeHtml(el.innerHTML.trim()) });
    }
  }

  function tqSaveNarrative() {
    const el = document.getElementById('tq-narrative');
    if (!el) return;
    const students = getTqStudents();
    const sid = students[tqStudentIndex]?.id;
    if (!sid) return;
    const termId = getTermId();
    upsertTermRating(_activeCourse, sid, termId, { narrative: sanitizeHtml(el.innerHTML.trim()) });
  }

  /* ── Rich text toolbar commands ── */
  var tqNarrativeDirty = false;

  function tqExec(cmd, value) {
    const editor = document.getElementById('tq-narrative');
    if (!editor) return;
    editor.focus();
    document.execCommand(cmd, false, value || null);
    tqNarrativeDirty = true;
    tqUpdateToolbar();
  }

  function tqUpdateToolbar() {
    const cmds = ['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList'];
    cmds.forEach(cmd => {
      const btn = document.querySelector(`.tq-tb-btn[data-cmd="${cmd}"]`);
      if (btn) btn.classList.toggle('active', document.queryCommandState(cmd));
    });
  }

  function tqCopyNarrative() {
    const editor = document.getElementById('tq-narrative');
    if (!editor) return;
    const text = editor.innerText;
    if (!text.trim()) return;
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('tq-copy-btn');
      btn.classList.add('copied');
      btn.title = 'Copied!';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.title = 'Copy to Clipboard';
      }, 1800);
    });
  }

  // Update active states on selection change & keyup

  function tqSetDim(sid, dim, val) {
    tqSaveNarrative();
    const termId = getTermId();
    const existing = getStudentTermRating(_activeCourse, sid, termId);
    const defaultDims = {};
    OBS_DIMS.forEach(d => {
      defaultDims[d] = 0;
    });
    const currentDims = existing ? { ...defaultDims, ...existing.dims } : defaultDims;
    currentDims[dim] = currentDims[dim] === val ? 0 : val; // Toggle off if same
    upsertTermRating(_activeCourse, sid, termId, { dims: currentDims });
    rerender();
  }

  function tqSetField(sid, field, val) {
    tqSaveNarrative();
    const termId = getTermId();
    const existing = getStudentTermRating(_activeCourse, sid, termId) || {};
    const newVal = existing[field] === val ? 0 : val; // Toggle off if same
    upsertTermRating(_activeCourse, sid, termId, { [field]: newVal });
    rerender();
  }

  function tqToggleTrait(sid, traitId) {
    tqSaveNarrative();
    const termId = getTermId();
    const existing = getStudentTermRating(_activeCourse, sid, termId) || {};
    const traits = [...(existing.socialTraits || [])];
    const idx = traits.indexOf(traitId);
    if (idx >= 0) traits.splice(idx, 1);
    else traits.push(traitId);
    upsertTermRating(_activeCourse, sid, termId, { socialTraits: traits });
    rerender();
  }

  function tqToggleAssignment(sid, aId) {
    tqSaveNarrative();
    const termId = getTermId();
    const existing = getStudentTermRating(_activeCourse, sid, termId) || {};
    const list = [...(existing.mentionAssessments || [])];
    const idx = list.indexOf(aId);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(aId);
    upsertTermRating(_activeCourse, sid, termId, { mentionAssessments: list });
    rerender();
  }

  function tqToggleOb(sid, obId) {
    tqSaveNarrative();
    const termId = getTermId();
    const existing = getStudentTermRating(_activeCourse, sid, termId) || {};
    const list = [...(existing.mentionObs || [])];
    const idx = list.indexOf(obId);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(obId);
    upsertTermRating(_activeCourse, sid, termId, { mentionObs: list });
    rerender();
  }

  function tqAutoNarrative(sid) {
    const cid = _activeCourse;
    const student = getStudents(cid).find(s => s.id === sid);
    if (!student) return;
    const termId = getTermId();
    const rating = getStudentTermRating(cid, sid, termId) || {};
    const dims = rating.dims || {};
    const name = displayNameFirst(student);
    const pr = getPronouns(student);
    const course = COURSES[cid];
    const courseName = course?.name || 'this course';
    const S = pr.capSubj,
      s = pr.subj,
      P = pr.poss.charAt(0).toUpperCase() + pr.poss.slice(1),
      p = pr.poss,
      o = pr.obj,
      v = pr.verb;
    const ve = v === 's' ? "'s" : "'ve"; // contraction: "she's" or "they've"
    const is_ = v === 's' ? 'is' : 'are'; // pronoun subject: "she is" / "they are"
    const nis = 'is'; // name subject: "Sam is" (always singular)
    const has = v === 's' ? 'has' : 'have';
    const nhas = 'has'; // name subject: "Sam has" (always singular)
    const does = v === 's' ? 'does' : 'do';

    // ── Helpers ──
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const oxList = (arr, conj = 'and') => {
      if (!arr || arr.length === 0) return '';
      if (arr.length === 1) return arr[0];
      if (arr.length === 2) return `${arr[0]} ${conj} ${arr[1]}`;
      return arr.slice(0, -1).join(', ') + `, ${conj} ${arr[arr.length - 1]}`;
    };
    // Avoid starting too many sentences with the same word
    let lastSubject = '';
    const vary = (preferred, fallbacks) => {
      if (preferred.startsWith(name) && lastSubject === 'name') return pick(fallbacks);
      if (preferred.startsWith(S) && lastSubject === 'pronoun') return pick(fallbacks);
      lastSubject = preferred.startsWith(name) ? 'name' : preferred.startsWith(S) ? 'pronoun' : '';
      return preferred;
    };

    // ── Gather ALL data ──
    const overall = getOverallProficiency(cid, sid);
    const overallR = Math.round(overall);
    const overallLabel = (PROF_LABELS[overallR] || '').toLowerCase();
    const sections = getSections(cid);
    const allTags = getAllTags(cid);
    const allObs = getStudentQuickObs(cid, sid);
    const assessments = getAssessments(cid);
    const studentScores = getScores(cid)[sid] || [];
    const completion = getCompletionPct(cid, sid);
    const reflections = getReflections(cid);
    const studentReflections = reflections[sid] || {};

    // Dimension analysis
    const dimThrive = OBS_DIMS.filter(d => (dims[d] || 0) >= 4).map(d => OBS_LABELS[d].toLowerCase());
    const dimSolid = OBS_DIMS.filter(d => (dims[d] || 0) === 3).map(d => OBS_LABELS[d].toLowerCase());
    const dimDev = OBS_DIMS.filter(d => (dims[d] || 0) === 2).map(d => OBS_LABELS[d].toLowerCase());
    const dimNeeds = OBS_DIMS.filter(d => (dims[d] || 0) === 1).map(d => OBS_LABELS[d].toLowerCase());
    const allDimStrengths = [...dimThrive, ...dimSolid];

    // Traits
    const traits = rating.socialTraits || [];
    const posTraits = traits.filter(t =>
      [
        'leader',
        'collaborative',
        'independent',
        'peer-mentor',
        'risk-taker',
        'reflective',
        'creative',
        'persistent',
        'organized',
        'empathetic',
        'curious',
        'respectful',
        'positive-attitude',
        'detail-oriented',
        'advocate',
      ].includes(t),
    );
    const negTraits = traits.filter(t =>
      [
        'needs-support',
        'often-late',
        'device-issue',
        'reminders-focus',
        'often-absent',
        'incomplete-work',
        'disorganized',
        'off-task',
        'social-conflicts',
        'low-confidence',
        'avoids-challenges',
        'rushed-work',
      ].includes(t),
    );

    // Tags
    const savedStrengths = (rating.strengths || []).map(id => allTags.find(t => t.id === id)?.label).filter(Boolean);
    const savedGrowth = (rating.growthAreas || []).map(id => allTags.find(t => t.id === id)?.label).filter(Boolean);

    // Section proficiencies
    const sectionData = sections
      .map(sec => ({ name: sec.shortName || sec.name, prof: getSectionProficiency(cid, sid, sec.id) }))
      .filter(sec => sec.prof > 0);
    sectionData.sort((a, b) => b.prof - a.prof);
    const topSecs = sectionData.filter(sec => sec.prof >= 3);
    const lowSecs = sectionData.filter(sec => sec.prof > 0 && sec.prof < 2.5);

    // Observation analysis
    const obsCount = allObs.length;
    const strengthObs = allObs.filter(ob => ob.sentiment === 'strength');
    const concernObs = allObs.filter(ob => ob.sentiment === 'concern');
    const contextCounts = {};
    allObs.forEach(ob => {
      if (ob.context) contextCounts[ob.context] = (contextCounts[ob.context] || 0) + 1;
    });
    const topContextEntry = Object.entries(contextCounts).sort((a, b) => b[1] - a[1])[0];
    const topContext = topContextEntry ? topContextEntry[0] : null;

    // Self-reflection analysis
    const refEntries = Object.entries(studentReflections).filter(([, r]) => r && r.confidence > 0);
    const highConfidence = refEntries.filter(([, r]) => r.confidence >= 3);
    const lowConfidence = refEntries.filter(([, r]) => r.confidence <= 1);
    const selfAware = refEntries.length > 0; // student has done self-assessment

    // Mentioned assignments
    const mentionIds = rating.mentionAssessments || [];
    const mentionedAssignments = mentionIds
      .map(aId => {
        const a = assessments.find(x => x.id === aId);
        if (!a) return null;
        const aScores = studentScores.filter(sc => sc.assessmentId === aId && sc.score > 0);
        const avg = aScores.length > 0 ? aScores.reduce((sum, sc) => sum + sc.score, 0) / aScores.length : 0;
        const r = Math.round(avg);
        return { title: a.title, avg, r, level: (PROF_LABELS[r] || '').toLowerCase(), type: a.type || 'summative' };
      })
      .filter(Boolean);
    const strongAssign = mentionedAssignments.filter(m => m.r >= 3);
    const weakAssign = mentionedAssignments.filter(m => m.r < 3);

    // Mentioned observations
    const mentionObIds = rating.mentionObs || [];
    const mentionedObs = allObs.filter(ob => mentionObIds.includes(ob.id));

    // ── Determine student profile archetype ──
    // This shapes the entire narrative arc
    const wh = rating.workHabits || 0;
    const pa = rating.participation || 0;
    let archetype = 'steady'; // default
    if (overall >= 3.5 && allDimStrengths.length >= 3 && wh >= 3) archetype = 'star';
    else if (overall >= 3 && allDimStrengths.length >= 2) archetype = 'strong';
    else if (overall >= 2.5 || (allDimStrengths.length >= 2 && wh >= 3)) archetype = 'steady';
    else if (overall > 0 && overall < 2.5) archetype = 'building';
    else if (overall === 0) archetype = 'early';
    // Override: if concerns dominate
    if (negTraits.length >= 2 || dimNeeds.length >= 3) archetype = 'building';

    // ── PARAGRAPH BUILDERS ──
    // Each function returns a paragraph string. The narrative is composed of 3-4 paragraphs.
    const paras = [];

    // ═══ PARAGRAPH 1: OPENING + LEARNER CHARACTER ═══
    {
      let p1 = '';

      // Opening line — sets tone from archetype
      const openings = {
        star: [
          `${name} has had an outstanding term in ${courseName}. ${S}${ve} brought energy, focus, and genuine curiosity to everything we've done`,
          `It\u2019s been a pleasure watching ${name} this term — ${s} ${has} consistently gone above and beyond in ${courseName}`,
          `${name} is one of those students who makes teaching rewarding. This term in ${courseName}, ${s} ${has} truly excelled`,
          `I can't say enough good things about ${name}'s term in ${courseName}. ${S} ${has} been exceptional in every sense`,
          `${name} has set the bar high in ${courseName} this term — ${p} dedication and talent have been on full display`,
          `What a term for ${name} in ${courseName}. ${S} ${has} risen to every challenge and then some`,
        ],
        strong: [
          `${name} has had a strong term in ${courseName}`,
          `I've been really pleased with ${name}'s work in ${courseName} this term`,
          `${name} has shown a lot of growth and effort in ${courseName} this term`,
          `${name} has had a really good term in ${courseName}, and the effort shows`,
          `There's a lot to celebrate about ${name}'s work in ${courseName} this term`,
          `${name} has made me proud this term in ${courseName} — ${s} ${has} put in consistently strong effort`,
        ],
        steady: [
          `${name} has had a solid term in ${courseName}`,
          `${name} has been steady and consistent in ${courseName} this term`,
          `This has been a good term for ${name} in ${courseName}`,
          `${name} has put together a dependable term in ${courseName}, with some nice highlights along the way`,
          `${name} has been making progress in ${courseName} and I see the foundations getting stronger`,
          `This term in ${courseName}, ${name} has shown the kind of steady growth that builds lasting skills`,
        ],
        building: [
          `${name} has been working through some challenges in ${courseName} this term, but I can see real effort`,
          `This term in ${courseName} has had its ups and downs for ${name}, but there are things to build on`,
          `${name} is still finding ${p} footing in ${courseName}, and I want to highlight both the progress and the areas where ${s} need${v} support`,
          `${name} has faced some real challenges in ${courseName} this term, and I want to be honest about what I see while also recognizing ${p} efforts`,
          `There have been some bumps along the way in ${courseName} for ${name}, but I see potential that's worth investing in`,
        ],
        early: [
          `${name} is getting started in ${courseName} and we're still building a picture of ${p} strengths`,
          `We're early in the process with ${name} in ${courseName}`,
          `${name} is still settling into ${courseName}, and I'm looking forward to getting to know ${p} strengths better`,
          `We're in the early stages with ${name} in ${courseName}, but I'm already starting to see some of who ${s} ${is_} as a learner`,
        ],
      };
      p1 += pick(openings[archetype]) + '. ';

      // Weave in dispositions + traits as CHARACTER, not a list
      if (allDimStrengths.length > 0 && posTraits.length > 0) {
        // Merge character traits and dispositions into one portrait
        const traitNatural = {
          leader: 'a real leader',
          collaborative: 'genuinely collaborative',
          independent: 'wonderfully self-directed',
          'peer-mentor': 'always willing to help others',
          'risk-taker': 'not afraid to take chances',
          reflective: 'thoughtful about ' + p + ' own learning',
          creative: 'a creative thinker',
          persistent: "someone who doesn't give up easily",
          organized: 'well-organized',
          empathetic: 'genuinely empathetic toward others',
          curious: 'naturally curious',
          respectful: 'consistently respectful',
          'positive-attitude': 'someone who brings a positive energy to the room',
          'detail-oriented': 'impressively detail-oriented',
          advocate: 'a strong self-advocate',
        };
        const charBits = posTraits.map(t => traitNatural[t]).filter(Boolean);
        const mainTraits = charBits.slice(0, 3);
        const extraTraits = charBits.slice(3);
        if (allDimStrengths.length <= 2) {
          p1 += pick([
            `${S} ${is_} ${oxList(mainTraits)}, and that really comes through in ${p} ${oxList(allDimStrengths)}. `,
            `In the classroom, ${s} ${is_} ${oxList(mainTraits)}. This shows up clearly in ${p} ${oxList(allDimStrengths)}. `,
            `What I notice most about ${name} is that ${s} ${is_} ${oxList(mainTraits)} — qualities that shine through in ${p} ${oxList(allDimStrengths)}. `,
          ]);
        } else {
          p1 += pick([
            `In the classroom, ${name} ${nis} ${oxList(mainTraits)}. ${P} ${oxList(allDimStrengths.slice(0, 3))} ${allDimStrengths.length === 1 ? `${is_} a` : 'are'} particular standout${allDimStrengths.length === 1 ? '' : 's'}. `,
            `${name} ${nis} ${oxList(mainTraits)}, and that translates into real strength across ${p} ${oxList(allDimStrengths.slice(0, 3))}. `,
            `As a person, ${name} ${nis} ${oxList(mainTraits)}. As a learner, that means ${p} ${oxList(allDimStrengths.slice(0, 3))} ${allDimStrengths.length === 1 ? `${is_}` : 'are'} really strong. `,
          ]);
        }
        if (extraTraits.length > 0) {
          p1 += pick([
            `${S} ${is_} also ${oxList(extraTraits)}. `,
            `On top of that, ${s} ${is_} ${oxList(extraTraits)}. `,
            `I'd also add that ${s} ${is_} ${oxList(extraTraits)}. `,
            `It's also worth noting that ${s} ${is_} ${oxList(extraTraits)} — all qualities that make ${o} a valued member of our class. `,
          ]);
        }
      } else if (allDimStrengths.length > 0) {
        if (allDimStrengths.length === 1) {
          p1 += pick([
            `${P} ${allDimStrengths[0]} has been a real strength this term. `,
            `I've been especially impressed by ${p} ${allDimStrengths[0]}. `,
            `One thing that stands out about ${name} is ${p} ${allDimStrengths[0]} — it's been a consistent strength. `,
            `In terms of who ${s} ${is_} as a learner, ${p} ${allDimStrengths[0]} is something I really want to highlight. `,
          ]);
        } else {
          p1 += pick([
            `${S} show${v} real strength in ${oxList(allDimStrengths)} as a learner. `,
            `As a learner, ${p} ${oxList(allDimStrengths)} really stand${allDimStrengths.length === 1 ? 's' : ''} out. `,
            `${P} strongest learning dispositions are in ${oxList(allDimStrengths)}, and those qualities serve ${o} well every day in class. `,
            `I consistently see strong ${oxList(allDimStrengths)} from ${name} — these are the qualities that anchor ${p} learning. `,
          ]);
        }
      } else if (posTraits.length > 0) {
        const traitNatural2 = {
          leader: 'leadership',
          collaborative: 'ability to collaborate',
          independent: 'independence',
          'peer-mentor': 'willingness to support classmates',
          'risk-taker': 'willingness to take risks',
          reflective: 'reflective nature',
          creative: 'creative thinking',
          persistent: 'persistence',
          organized: 'strong organization',
          empathetic: 'empathy toward classmates',
          curious: 'natural curiosity',
          respectful: 'respectfulness',
          'positive-attitude': 'positive attitude',
          'detail-oriented': 'attention to detail',
          advocate: 'ability to advocate for ' + p + 'self',
        };
        const traitWords = posTraits.map(t => traitNatural2[t]).filter(Boolean);
        p1 += pick([
          `I really value ${p} ${oxList(traitWords)} in our class. `,
          `In our classroom community, ${name} brings ${oxList(traitWords)} — and that makes a real difference. `,
          `${P} ${oxList(traitWords)} ${traitWords.length === 1 ? 'is' : 'are'} qualities I've come to rely on in our class. `,
        ]);
      } else if (archetype !== 'early') {
        // No specific traits or dims — add a general learner observation
        p1 += pick([
          `${S} ${is_} continuing to develop as a learner, and I appreciate ${p} willingness to show up and try. `,
          `While we're still building a complete picture of ${p} learning profile, I can see that ${s} ${is_} someone who cares about doing well. `,
        ]);
      }

      // Developing dimensions — mention briefly, woven in naturally
      if (dimDev.length > 0 && dimDev.length <= 2) {
        p1 += pick([
          `${S}${ve} also been growing in ${oxList(dimDev)}, which is encouraging to see. `,
          `I've also noticed positive growth in ${p} ${oxList(dimDev)} this term. `,
          `It's worth mentioning that ${p} ${oxList(dimDev)} ${dimDev.length === 1 ? 'has' : 'have'} been developing nicely too. `,
        ]);
      } else if (dimDev.length > 2) {
        p1 += pick([
          `${S}${ve} been growing across several areas including ${oxList(dimDev.slice(0, 3))}, and I look forward to that continued development. `,
          `There are several areas where ${s} ${is_} still developing — ${oxList(dimDev.slice(0, 3))} — and each one is moving in the right direction. `,
        ]);
      }

      // Work habits + participation — combine into one flowing thought
      if (wh > 0 && pa > 0) {
        const whpa = {
          '4,4': [
            `${name} comes prepared every day and ${is_} always an active, thoughtful voice in our discussions. That combination of preparation and engagement makes a real difference in ${p} learning.`,
            `${P} work ethic is excellent, and ${s} bring${v} that same energy to class conversations — always engaged, always contributing. It's the kind of consistency that sets a great example.`,
            `On the day-to-day, ${name} ${nis} exactly where I want ${o} to be — consistently prepared, consistently engaged, and always willing to share ${p} thinking with the class.`,
          ],
          '4,3': [
            `${name} has a fantastic work ethic and participates meaningfully in class discussions. ${S} come${v} prepared and ready to learn every day.`,
            `${S} always come${v} prepared and ${is_} a reliable contributor to our conversations. ${P} consistent effort really shows in the quality of ${p} work.`,
            `${name}'s preparation is top-notch, and ${s} ${is_} a solid voice in class discussions — not always the loudest, but always thoughtful when ${s} contribute${v}.`,
          ],
          '4,2': [
            `${name}'s work ethic is impressive — ${s} always come${v} prepared — though I'd love to hear ${p} voice more during class discussions. When ${s} ${does} speak up, it's always worthwhile.`,
            `${S} put${v} in great effort on ${p} work, and the results show it. The next step would be bringing that same confidence into class conversations, because I know ${s} ${has} great ideas to share.`,
            `${name}'s assignments are consistently strong, which tells me ${s} really understand${v} the material. I'd like to see ${o} share that understanding more during our group discussions.`,
          ],
          '4,1': [
            `${name} does excellent work on ${p} own, but ${is_} quite reserved in class. I'd really like to hear ${p} ideas more often — when ${s} ${does} share, it's always insightful.`,
            `The quality of ${name}'s independent work is impressive, but ${s} rarely speak${v} up in group settings. I genuinely believe the class would benefit from hearing ${p} perspective more.`,
          ],
          '3,4': [
            `${name} is a reliable worker and one of our most active contributors in class — always willing to share ideas and ask questions. That enthusiasm really enriches our discussions.`,
            `${S} keep${v} up with ${p} work and ${is_} one of the first to jump into any class conversation. ${P} willingness to participate and take risks with ${p} thinking is wonderful to see.`,
          ],
          '3,3': [
            `${name} is consistent — ${s} come${v} to class prepared and ${is_} always willing to participate. It's the kind of reliable effort that builds a strong foundation.`,
            `${S}${ve} been dependable with ${p} work and a regular participant in class. That consistency is something I value, and it's paying off in ${p} learning.`,
            `Day to day, ${name} ${nis} solid — ${s} get${v} ${p} work done, ${s} engage${v} in discussions, and ${s} ${is_} a steady presence in our classroom.`,
          ],
          '3,2': [
            `${name} generally keeps up with ${p} work, though ${s} tend${v} to be quieter during class discussions. I know ${s} ${has} ideas worth sharing, and I'd love to hear them more.`,
            `${P} work habits are solid, and I can tell ${s} ${is_} keeping up with the material. The one area I'd push on is participation — ${s} tend${v} to sit back during discussions when ${s} could be contributing.`,
          ],
          '3,1': [
            `${name} keeps up with the work but rarely speaks up in class. I think ${s} ${has} valuable ideas to share, and I'd like to find ways to help ${o} feel more comfortable contributing.`,
            `${P} written work and assignments show real understanding, which makes it all the more important that ${s} find${v} ${p} voice in class. I know the ideas are there — they just need to come out.`,
          ],
          '2,4': [
            `${name} is one of our most enthusiastic participants, which I really appreciate. The area to work on is follow-through on assignments — ${p} participation shows ${s} get${v} it, so the work just needs to match.`,
            `${S} bring${v} great energy to discussions but need${v} to match that with more consistent work habits. The good news is that ${p} understanding of the material is clearly there.`,
            `In class, ${name} ${nis} fantastic — engaged, vocal, and willing to take risks with ${p} thinking. Outside of class, though, ${p} work completion has been inconsistent, and that's holding ${o} back.`,
          ],
          '2,3': [
            `${name}'s participation is solid, though ${p} work habits have been a bit up and down — some weeks are great, others need a push. When ${s} ${is_} on, ${s} ${is_} really on.`,
            `${S} participate${v} well in class and ${is_} clearly engaged with the material, but the assignments don't always reflect that. I'd like to see more consistency in ${p} work completion.`,
          ],
          '2,2': [
            `${name} has been somewhat inconsistent this term, both with ${p} work and ${p} participation. There are flashes of great effort, and I'd like to see more of that on a daily basis.`,
            `Consistency has been the challenge for ${name} this term. Some days ${s} ${is_} fully engaged and producing great work; other days, ${s} seem${v} to coast. I know ${s} ${is_} capable of more.`,
          ],
          '2,1': [
            `Both work habits and participation have been a challenge for ${name} this term. ${S} need${v} more consistent effort on assignments and more willingness to engage in class. I want to help ${o} find strategies that work.`,
            `I'm seeing ${name} disengage at times — both in class conversations and in completing assignments. It's something I want to address because I know there's more inside ${o} than what ${s}${ve} been showing.`,
          ],
          '1,4': [
            `${name} is very vocal in class, which I appreciate — ${p} contributions to our discussions are valuable. But ${p} work completion has been a real concern, and it's affecting ${p} ability to show what ${s} know${v}.`,
            `In discussions, ${name} ${nis} one of our strongest voices. Outside of discussions, though, assignments go missing or come in late. If ${s} can bring that same energy to ${p} independent work, it would make a huge difference.`,
          ],
          '1,3': [
            `${name} participates when ${s} ${is_} in class and clearly cares about the content, but keeping up with assignments has been a struggle. We need to find better systems to help ${o} stay on track.`,
            `${name} engages in class and can have really strong contributions, but the assignments aren't getting done consistently. That gap between ${p} classroom presence and ${p} work output is something we need to address.`,
          ],
          '1,2': [
            `I'm concerned about ${name}'s work completion and engagement — both have been below where they need to be. I know ${s} can do better, and I'd like to work together to find what ${s} need${v}.`,
            `This term has been a struggle for ${name} in terms of both getting work done and engaging in class. I don't say that to be discouraging — I say it because I believe ${s} ${is_} capable of so much more.`,
          ],
          '1,1': [
            `Work habits and participation have both been significant challenges for ${name} this term. We need to find strategies to help ${o} engage more — this isn't sustainable, and I want to be part of the solution.`,
            `I want to be honest that ${name} has struggled to engage with ${courseName} this term, both in class and with ${p} assignments. I care about ${p} success and want to work together on a plan to turn things around.`,
          ],
        };
        const key = `${wh},${pa}`;
        p1 +=
          pick(whpa[key] || [`${name} has been working on developing ${p} work habits and participation this term.`]) +
          ' ';
      } else if (wh > 0) {
        const whOnly = {
          4: [
            `${P} work ethic has been excellent this term — ${s} consistently turn${v} in high-quality work on time.`,
            `${name} ${nis} one of the most reliable students when it comes to getting work done well and on time.`,
          ],
          3: [
            `${S}${ve} been reliable with ${p} work, generally turning things in on time and with care.`,
            `${name} ${nis} dependable with ${p} assignments — not always perfect, but consistently solid.`,
          ],
          2: [
            `${P} work habits have been inconsistent — I know ${s} can be more consistent, and I want to help ${o} get there.`,
            `Work completion has been hit or miss for ${name}. Some assignments are great; others don't get finished.`,
          ],
          1: [
            `Work completion has been a real challenge, and we need to work on building better habits together.`,
            `Turning in work has been a significant struggle for ${name} this term, and it's something we need to address head-on.`,
          ],
        };
        p1 += pick(whOnly[wh]) + ' ';
      } else if (pa > 0) {
        const paOnly = {
          4: [
            `${S} ${is_} one of our most active and thoughtful contributors in class — the kind of participant who makes discussions richer for everyone.`,
            `${name} consistently brings energy and insight to our class conversations. ${P} contributions make a real difference.`,
          ],
          3: [
            `${S}${ve} been a regular and welcome participant in our discussions, and I appreciate ${p} willingness to share.`,
            `${name} participates regularly and ${p} contributions show real engagement with the material.`,
          ],
          2: [
            `${S} participate${v} when prompted, but I'd like to see ${o} volunteering more — ${p} ideas are worth hearing.`,
            `${name} can be quiet in class and often needs encouragement to share ${p} thinking. I'd love to hear more from ${o}.`,
          ],
          1: [
            `I'd really like to see ${name} participate more in class — ${p} ideas matter, and the class would be better for hearing them.`,
            `Participation has been a real challenge — ${name} rarely speak${v} up, and I want to find ways to make ${o} feel more comfortable contributing.`,
          ],
        };
        p1 += pick(paOnly[pa]) + ' ';
      }

      paras.push(p1.trim());
    }

    // ═══ PARAGRAPH 2: ACADEMIC PICTURE — evidence, specifics, assignments ═══
    {
      let p2 = '';

      if (overall > 0) {
        // Open with academic standing + sections
        if (topSecs.length > 0 && lowSecs.length > 0) {
          const topNames = topSecs.slice(0, 2).map(sec => sec.name.toLowerCase());
          const lowNames = lowSecs.slice(0, 2).map(sec => sec.name.toLowerCase());
          p2 += pick([
            `Academically, ${name} is working at a ${overallLabel} level overall. ${S} ${does} particularly well in ${oxList(topNames)}, while ${oxList(lowNames)} ${lowSecs.length === 1 ? 'is' : 'are'} where ${s} need${v} more development.`,
            `On the academic side, ${name} is at ${overallLabel}. ${P} strongest work has been in ${oxList(topNames)}, and ${s}${ve} got room to grow in ${oxList(lowNames)}.`,
            `Looking at the academics, ${name} ${nis} performing at a ${overallLabel} level. ${S} ${is_} doing ${p} best work in ${oxList(topNames)} and could use more support in ${oxList(lowNames)}.`,
            `${name}'s overall standing is ${overallLabel}. There's a nice split here: ${oxList(topNames)} ${topSecs.length === 1 ? 'is' : 'are'} clearly ${p} strong suit, while ${oxList(lowNames)} will need more attention going forward.`,
          ]);
        } else if (topSecs.length > 0) {
          const topNames = topSecs.slice(0, 3).map(sec => sec.name.toLowerCase());
          p2 += pick([
            `Academically, ${name} is working at a ${overallLabel} level, with strong results in ${oxList(topNames)}.`,
            `${S}${ve} been performing at ${overallLabel} overall — ${p} work in ${oxList(topNames)} has been especially solid.`,
            `${name}'s academic profile is looking strong at ${overallLabel}, with particularly impressive results in ${oxList(topNames)}.`,
            `On the academic front, ${name} ${nis} at ${overallLabel}. ${P} work in ${oxList(topNames)} has been a real standout.`,
          ]);
        } else if (sectionData.length > 0) {
          // All sections middling — still interesting to comment on
          const allNames = sectionData.slice(0, 3).map(sec => sec.name.toLowerCase());
          p2 += pick([
            `Academically, ${name} is working at a ${overallLabel} level across ${oxList(allNames)}.`,
            `${name}'s academic work sits at ${overallLabel} overall, with fairly even performance across ${p} sections.`,
          ]);
          p2 += ' ';
        } else {
          p2 += `Academically, ${name} is working at a ${overallLabel} level${completion > 0 ? ` with ${Math.round(completion)}% of assessments completed` : ''}. `;
        }
        p2 += ' ';

        // Add a sentence about the spread / pattern if interesting
        if (sectionData.length >= 3) {
          const spread = sectionData[0].prof - sectionData[sectionData.length - 1].prof;
          if (spread >= 2) {
            p2 += pick([
              `There's quite a range across ${p} sections — ${s} ${is_} clearly stronger in some areas than others, which is totally normal and helps us know where to focus. `,
              `The data shows real variation across sections, which gives us a clear picture of where to concentrate ${p} energy. `,
            ]);
          } else if (spread <= 0.5 && overallR >= 3) {
            p2 += pick([
              `What's nice is that ${p} performance is consistently strong across all areas — there's no real weak spot to speak of. `,
              `${S} ${is_} performing steadily across the board, which is a great sign. `,
            ]);
          }
        }
      }

      // Strengths + growth tags woven into academic narrative
      if (savedStrengths.length > 0 && savedGrowth.length > 0) {
        const sNames = savedStrengths.slice(0, 3).map(n => n.toLowerCase());
        const gNames = savedGrowth.slice(0, 3).map(n => n.toLowerCase());
        p2 += pick([
          `${S} ${has} shown particular strength in ${oxList(sNames)}, while ${oxList(gNames)} ${savedGrowth.length === 1 ? 'remains' : 'remain'} areas for continued development. `,
          `Specific curriculum strengths include ${oxList(sNames)}. On the flip side, ${oxList(gNames)} ${savedGrowth.length === 1 ? 'is' : 'are'} where I'd like to see the most improvement. `,
          `When I look at the specifics, ${name}'s strengths in ${oxList(sNames)} are clear. The growth areas to target are ${oxList(gNames)}. `,
          `${name} really shines when it comes to ${oxList(sNames)}. The areas that need the most attention are ${oxList(gNames)}, and those will be our focus going forward. `,
        ]);
      } else if (savedStrengths.length > 0) {
        const sNames = savedStrengths.slice(0, 3).map(n => n.toLowerCase());
        p2 += pick([
          `${S} ${has} shown particular strength in ${oxList(sNames)}. `,
          `I want to specifically call out ${p} work in ${oxList(sNames)} — that's where ${s} really shine${v}. `,
          `Curriculum-wise, ${oxList(sNames)} ${savedStrengths.length === 1 ? 'is' : 'are'} where ${name} ${nis} at ${p} best. `,
        ]);
      } else if (savedGrowth.length > 0) {
        const gNames = savedGrowth.slice(0, 3).map(n => n.toLowerCase());
        p2 += pick([
          `The main areas to focus on going forward are ${oxList(gNames)}. `,
          `Looking ahead, I'd like ${name} to put extra energy into ${oxList(gNames)} — that's where the biggest gains are waiting. `,
          `For next steps, the priority growth areas are ${oxList(gNames)}. `,
        ]);
      }

      // Specific assignments — this is the evidence that makes comments real
      if (strongAssign.length > 0 || weakAssign.length > 0) {
        if (strongAssign.length > 0 && weakAssign.length > 0) {
          if (strongAssign.length === 1 && weakAssign.length === 1) {
            p2 += pick([
              `For example, ${s} did really well on the ${strongAssign[0].title} (${strongAssign[0].level}), while the ${weakAssign[0].title} was more of a challenge (${weakAssign[0].level}). `,
              `The ${strongAssign[0].title} was a highlight at ${strongAssign[0].level}, though ${s} found the ${weakAssign[0].title} tougher, coming in at ${weakAssign[0].level}. `,
              `To give a concrete example: the ${strongAssign[0].title} was strong work (${strongAssign[0].level}), whereas the ${weakAssign[0].title} (${weakAssign[0].level}) showed ${s} still ${has} work to do in that area. `,
            ]);
          } else {
            const sA = strongAssign.map(m => m.title);
            const wA = weakAssign.map(m => m.title);
            p2 += pick([
              `${S} showed strong results on ${oxList(sA)}, while ${oxList(wA)} ${weakAssign.length === 1 ? 'was' : 'were'} more challenging. `,
              `Looking at specific assignments, ${oxList(sA)} ${strongAssign.length === 1 ? 'was' : 'were'} real highlights. ${oxList(wA)}, on the other hand, showed areas that still need work. `,
            ]);
          }
        } else if (strongAssign.length > 0) {
          if (strongAssign.length === 1) {
            p2 += pick([
              `A highlight was the ${strongAssign[0].title}, where ${s} reached ${strongAssign[0].level}. `,
              `${S} did particularly well on the ${strongAssign[0].title} (${strongAssign[0].level}). `,
              `I want to specifically highlight the ${strongAssign[0].title} — ${s} earned ${strongAssign[0].level} and it showed real understanding. `,
              `The ${strongAssign[0].title} was a standout piece of work, coming in at ${strongAssign[0].level}. `,
            ]);
          } else {
            p2 += pick([
              `Notable successes include ${oxList(strongAssign.map(m => `the ${m.title} (${m.level})`))}. `,
              `I want to highlight ${oxList(strongAssign.map(m => `the ${m.title} (${m.level})`))} — these were excellent pieces of work. `,
            ]);
          }
        } else if (weakAssign.length > 0) {
          if (weakAssign.length === 1) {
            p2 += pick([
              `The ${weakAssign[0].title} was a challenge (${weakAssign[0].level}) and something to revisit. `,
              `${S} struggled with the ${weakAssign[0].title} (${weakAssign[0].level}), and that's an area we can work on. `,
            ]);
          } else {
            p2 += pick([
              `${oxList(weakAssign.map(m => `the ${m.title}`))} were areas of difficulty and worth revisiting. `,
              `Assignments like ${oxList(weakAssign.map(m => `the ${m.title}`))} were tougher, and they point to where ${s} need${v} more practice. `,
            ]);
          }
        }
        // Add a reflective bridge after assignments
        if (strongAssign.length > 0 && weakAssign.length > 0) {
          p2 += pick([
            `That mix of highs and lows is actually useful — it tells us exactly where to focus. `,
            `This kind of variation is normal and helps us pinpoint ${p} next steps. `,
            ``,
          ]);
        }
      } else if (overall > 0 && mentionedAssignments.length === 0 && assessments.length > 0) {
        // No mentioned assignments but we have assessment data — add a general note
        const completedCount = studentScores.filter(sc => sc.score > 0).length;
        if (completedCount > 0) {
          p2 += pick([
            `Across ${p} assessed work this term, ${s}${ve} shown ${overallR >= 3 ? 'a solid grasp of the material' : 'progress toward understanding the key concepts'}. `,
            `The body of work ${s}${ve} produced this term ${overallR >= 3 ? 'demonstrates real competence' : 'shows growing understanding, with room to deepen'}.  `,
          ]);
        }
      }

      if (p2.trim()) paras.push(p2.trim());
    }

    // ═══ PARAGRAPH 3: EVIDENCE FROM OBSERVATIONS + SELF-REFLECTION ═══
    {
      let p3 = '';

      // Teacher observations — woven in as specific moments
      // Observations are free-text and can be noun phrases, fragments, or full sentences.
      // Use colon-introduction or "for example" framing to avoid grammar mismatches.
      if (mentionedObs.length > 0) {
        const obData = mentionedObs.map(ob => {
          const raw = esc(ob.text.trim().replace(/\.$/, ''));
          return { text: raw, sentiment: ob.sentiment, context: ob.context };
        });

        const ctxMap = {
          'whole-class': 'during a whole-class activity',
          'small-group': 'during small group work',
          independent: 'while working independently',
          presentation: 'during a presentation',
          discussion: 'in a class discussion',
        };

        if (obData.length === 1) {
          const ob = obData[0];
          const when = ob.context ? ' ' + (ctxMap[ob.context] || '') : '';

          if (ob.sentiment === 'strength') {
            p3 += pick([
              `One moment that really stood out${when}: "${ob.text}." That's the kind of work I love to see from ${name}. `,
              `I want to highlight a specific moment${when} — "${ob.text}." `,
              `A great example of what ${name} is capable of: "${ob.text}." `,
              `Here's something I wrote down${when} that captures ${name} at ${p} best: "${ob.text}." `,
              `I was especially impressed${when} when I observed: "${ob.text}." This is exactly the kind of thing I hope to see more of. `,
              `This note from my records${when} says it better than I could summarize: "${ob.text}." `,
            ]);
          } else if (ob.sentiment === 'concern') {
            p3 += pick([
              `I did want to mention one thing${when}: "${ob.text}." It's something we can work on together. `,
              `One area I noted${when}: "${ob.text}." I think with some focus, this can improve. `,
              `I want to be transparent about something I observed${when}: "${ob.text}." I'm confident we can address this with the right support. `,
            ]);
          } else {
            p3 += pick([
              `From my notes${when}: "${ob.text}." `,
              `One thing I jotted down${when}: "${ob.text}." `,
              `A recent observation${when}: "${ob.text}." `,
              `Something I noted${when} that I think is worth sharing: "${ob.text}." `,
            ]);
          }
        } else {
          // Multiple observations — group by sentiment, weave naturally
          const posOb = obData.filter(ob => ob.sentiment === 'strength');
          const negOb = obData.filter(ob => ob.sentiment === 'concern');
          const neutOb = obData.filter(ob => ob.sentiment !== 'strength' && ob.sentiment !== 'concern');

          // Open with a framing sentence for multiple obs
          p3 += pick([
            `I keep detailed notes on students throughout the term, and ${name}'s tell a clear story. `,
            `Looking through my observation notes, a few things stand out. `,
            `I want to share some specific moments from class that give a fuller picture of ${name} as a learner. `,
          ]);

          if (posOb.length > 0) {
            if (posOb.length === 1) {
              p3 += pick([`A highlight: "${posOb[0].text}." `, `On the positive side: "${posOb[0].text}." `]);
            } else {
              p3 += pick([
                `Some highlights: "${posOb[0].text}"; "${posOb[1].text}."${posOb.length > 2 ? ` I also noted: "${posOb[2].text}."` : ''} `,
                `I recorded these strengths: "${posOb[0].text}" and "${posOb[1].text}."${posOb.length > 2 ? ` Also: "${posOb[2].text}."` : ''} These moments capture what ${name} ${nis} capable of. `,
              ]);
            }
          }
          if (neutOb.length > 0) {
            p3 += pick([
              `I also noted: "${neutOb.map(ob => ob.text).join('"; "')}." `,
              `Other moments I recorded: "${neutOb.map(ob => ob.text).join('"; "')}." `,
            ]);
          }
          if (negOb.length > 0) {
            p3 += pick([
              `Something to keep an eye on: "${negOb.map(ob => ob.text).join('"; "')}." `,
              `On a more challenging note: "${negOb.map(ob => ob.text).join('"; "')}." This is something we'll work on. `,
            ]);
          }
        }
      } else if (obsCount > 0) {
        // No specific obs selected but we have observation data — mention the pattern
        if (strengthObs.length > concernObs.length && strengthObs.length >= 2) {
          p3 += pick([
            `I've recorded ${obsCount} observations for ${name} this term, and the trend is positive — ${strengthObs.length} of those were flagged as strengths. That pattern tells me a lot about the kind of learner ${s} ${is_}.`,
            `My observation notes have been largely positive this term, with ${strengthObs.length} strength notes out of ${obsCount} total. ${name} is building a track record of strong classroom moments.`,
            `Across ${obsCount} classroom observations this term, the story is encouraging — the majority of my notes highlight ${name}'s strengths, with ${strengthObs.length} positive entries.`,
          ]);
          p3 += ' ';
        } else if (concernObs.length >= 2) {
          p3 += pick([
            `I've flagged some concerns in my observation notes this term that are worth discussing. I want us to work together to address these patterns. `,
            `My observation notes this term include ${concernObs.length} concerns, and I think it's important to talk about what I'm seeing so we can make a plan. `,
          ]);
        } else if (obsCount >= 3) {
          p3 += pick([
            `I've been tracking ${name}'s progress through ${obsCount} classroom observations this term, and the picture is coming into focus. `,
            `With ${obsCount} observations recorded this term, I have a good sense of how ${name} operates in different classroom settings. `,
          ]);
        }
        if (topContext) {
          const ctxLabel =
            {
              'whole-class': 'whole-class activities',
              'small-group': 'small group work',
              independent: 'independent work',
              presentation: 'presentations',
              discussion: 'class discussions',
            }[topContext] || topContext;
          p3 += pick([
            `Most of my observations have come from ${ctxLabel}. `,
            `I've particularly noticed ${p} patterns during ${ctxLabel}. `,
          ]);
        }
      }

      // Self-reflection data — this is powerful for parents
      if (selfAware) {
        // Bridge sentence if we also had observation content
        if (p3.trim()) {
          p3 += pick([
            `On the self-assessment side, `,
            `It's also worth looking at how ${name} sees ${p}self. `,
            `${name}'s own perspective is telling, too. `,
          ]);
        }
        if (highConfidence.length > 0 && lowConfidence.length > 0) {
          const hNames = highConfidence
            .slice(0, 2)
            .map(([secId]) => {
              const sec = sections.find(sec2 => sec2.id === secId);
              return sec ? (sec.shortName || sec.name).toLowerCase() : '';
            })
            .filter(Boolean);
          const lNames = lowConfidence
            .slice(0, 2)
            .map(([secId]) => {
              const sec = sections.find(sec2 => sec2.id === secId);
              return sec ? (sec.shortName || sec.name).toLowerCase() : '';
            })
            .filter(Boolean);
          p3 += pick([
            `${p3.trim() ? '' : 'In ' + p + ' own self-assessment, '}${name} feels confident about ${oxList(hNames)} but less sure about ${oxList(lNames)} — that self-awareness is really valuable and shows maturity as a learner. `,
            `${p3.trim() ? '' : 'Interestingly, '}${name}'s self-reflection shows ${s} feel${v} strong in ${oxList(hNames)} but recognize${v} ${s} need${v} growth in ${oxList(lNames)}. I appreciate that honesty — being able to identify your own growth areas is a skill in itself. `,
            `${name} feel${v} good about ${p} work in ${oxList(hNames)} while acknowledging that ${oxList(lNames)} need${v} more work. That kind of self-awareness is something I really value. `,
          ]);
        } else if (highConfidence.length > 0) {
          const hNames = highConfidence
            .slice(0, 2)
            .map(([secId]) => {
              const sec = sections.find(sec2 => sec2.id === secId);
              return sec ? (sec.shortName || sec.name).toLowerCase() : '';
            })
            .filter(Boolean);
          p3 += pick([
            `${name}'s own self-assessment shows ${s} feel${v} confident in ${oxList(hNames)}, which aligns with what I'm seeing in ${p} work. `,
            `${name} feel${v} strong in ${oxList(hNames)}, and the data backs that up — ${p} self-perception matches the academic picture nicely. `,
          ]);
        } else if (lowConfidence.length > 0) {
          const lNames = lowConfidence
            .slice(0, 2)
            .map(([secId]) => {
              const sec = sections.find(sec2 => sec2.id === secId);
              return sec ? (sec.shortName || sec.name).toLowerCase() : '';
            })
            .filter(Boolean);
          p3 += pick([
            `${name} has identified ${oxList(lNames)} as areas where ${s} feel${v} less confident — it's great that ${s} can recognize that, and we'll make sure to support ${o} there. `,
            `${name}'s self-reflection flags ${oxList(lNames)} as areas of lower confidence, and that's an important insight. Knowing where you need help is the first step to getting better. `,
          ]);
        }
      }

      if (p3.trim()) paras.push(p3.trim());
    }

    // ═══ PARAGRAPH 4: CONCERNS, GROWTH, NEXT STEPS + CLOSER ═══
    {
      let p4 = '';

      // Behavioural concerns — addressed directly but kindly
      if (negTraits.length > 0) {
        const cMap = {
          'needs-support': `benefits from additional support and encouragement`,
          'often-late': `has been arriving late to class more often than I'd like`,
          'device-issue': `sometimes struggles to manage ${p} device use during class time`,
          'reminders-focus': `needs regular check-ins to stay focused`,
          'often-absent': `has had a number of absences that are affecting ${p} continuity in class`,
          'incomplete-work': `has had trouble completing assignments on time`,
          disorganized: `could use help with organization — materials and work are often misplaced or hard to find`,
          'off-task': `can drift off-task during work time and needs redirection`,
          'social-conflicts': `has had some social conflicts with peers that have affected ${p} focus`,
          'low-confidence': `tends to doubt ${p}self and could use encouragement to trust ${p} own abilities`,
          'avoids-challenges': `tends to avoid challenging tasks and sticks to what feels safe`,
          'rushed-work': `often rushes through work without taking the time to do ${p} best`,
        };
        const concerns = negTraits.map(t => cMap[t]).filter(Boolean);
        const mainConcerns = concerns.slice(0, 3);
        const extraConcerns = concerns.slice(3);
        if (archetype === 'star' || archetype === 'strong') {
          p4 += `The main thing I'd flag is that ${name} ${oxList(mainConcerns)}. It's a small thing relative to all the positives. `;
        } else {
          p4 += pick([
            `I do want to be upfront that ${name} ${oxList(mainConcerns)}. `,
            `On the practical side, ${name} ${oxList(mainConcerns)}, and that's something we should address. `,
          ]);
        }
        if (extraConcerns.length > 0) {
          p4 += pick([
            `I've also noticed that ${s} ${oxList(extraConcerns)}. `,
            `Additionally, ${s} ${oxList(extraConcerns)}. `,
          ]);
        }
      }

      // Dimensions that need work
      if (dimNeeds.length > 0) {
        p4 += pick([
          `In terms of learning dispositions, ${oxList(dimNeeds)} ${dimNeeds.length === 1 ? 'is' : 'are'} where ${s} could use the most support. We'll be intentional about creating opportunities for growth in ${dimNeeds.length === 1 ? 'this area' : 'these areas'}. `,
          `I'd like to see ${name} build more confidence in ${oxList(dimNeeds)} going forward. These are skills that develop over time, and I'll be looking for ways to support that growth. `,
          `When it comes to learning dispositions, ${oxList(dimNeeds)} ${dimNeeds.length === 1 ? 'is' : 'are'} the area to watch. I'll be working with ${name} to find strategies that help. `,
        ]);
      }

      // Growth areas + next steps
      if (
        savedGrowth.length > 0 &&
        !paras.some(p => savedGrowth.some(g => p.toLowerCase().includes(g.toLowerCase())))
      ) {
        const gNames = savedGrowth.slice(0, 3).map(n => n.toLowerCase());
        p4 += pick([
          `Going forward, the key areas to focus on are ${oxList(gNames)}. With targeted practice and support, I'm confident ${s} can make real progress. `,
          `Looking ahead, our priorities will be ${oxList(gNames)}. I'll be designing learning opportunities that help ${name} strengthen ${p} skills in ${gNames.length === 1 ? 'this area' : 'these areas'}. `,
          `The roadmap for growth centers on ${oxList(gNames)}. These aren't weaknesses so much as opportunities — and I'm excited to see how ${name} responds to the challenge. `,
        ]);
      } else if (
        lowSecs.length > 0 &&
        savedGrowth.length === 0 &&
        !paras.some(pp => lowSecs.some(sec => pp.toLowerCase().includes(sec.name.toLowerCase())))
      ) {
        const sNames = lowSecs.slice(0, 2).map(sec => sec.name.toLowerCase());
        p4 += pick([
          `Going forward, we'll be focusing on building ${p} skills in ${oxList(sNames)}. I have a clear plan for how to support ${o}. `,
          `The plan for next term is to put more energy into ${oxList(sNames)}. These are areas where focused effort can make a meaningful difference. `,
          `Next term, I want to prioritize ${oxList(sNames)} for ${name}. With the right scaffolding and practice, I expect to see improvement. `,
        ]);
      }

      // If no specific growth content yet, add a forward-looking bridge
      if (!p4.trim() && archetype !== 'early') {
        p4 += pick([
          `Looking ahead, I want ${name} to keep building on what's working and stay open to feedback in the areas that need attention. `,
          `For next term, I'll be watching for continued growth and looking for ways to push ${name} to the next level. `,
        ]);
      }

      // Closer — warm, specific to archetype
      const closers = {
        star: [
          `${name} should be really proud of this term. I'm excited to see where ${s} go${v === 's' ? 'es' : ''} from here.`,
          `Fantastic work all around — ${name} ${nis} a joy to have in class, and I can't wait to see what ${s} do${v === 's' ? 'es' : ''} next.`,
          `Keep up the amazing work, ${name}. This has been a standout term, and ${s}${ve} set a high standard for ${p}self.`,
          `What an impressive term. ${name} ${nis} the kind of student who inspires the people around ${o}, and I'm genuinely excited about ${p} future.`,
          `This term has been something special for ${name}. ${S} should celebrate this — and then get ready to keep pushing.`,
        ],
        strong: [
          `${name} should feel good about this term — there's a lot to be proud of here, and the trajectory is pointing up.`,
          `A really strong term for ${name}. I'm looking forward to seeing ${o} continue to grow and challenge ${p}self.`,
          `Great effort this term. ${name} ${nis} heading in a really good direction, and with a few more steps, ${s} could truly excel.`,
          `I'm proud of what ${name} has accomplished this term. The effort is there, the talent is there — it's a great combination.`,
          `${name} has shown me a lot this term. I'm confident that with continued effort, ${s}${ve} got even bigger things ahead.`,
        ],
        steady: [
          `Overall, a positive term for ${name}. With continued effort, ${s}${ve} got a lot of room to grow, and I'm here to support that journey.`,
          `${name} ${nis} in a good place and I'm looking forward to seeing ${p} continued progress. The foundation is solid.`,
          `Solid work this term. The pieces are there — it's about putting them all together, and I'm optimistic about what's next.`,
          `${name} ${nis} building something here, step by step. I want ${o} to know that steady progress is still progress, and it matters.`,
          `I see a student who ${is_} capable of more and ${is_} getting closer to that potential every day. Keep it up, ${name}.`,
        ],
        building: [
          `I believe in ${name}'s potential and I'm committed to helping ${o} get there. Let's work on this together — I'm in ${p} corner.`,
          `There's real potential here, and with more consistent effort and the right support, I know ${name} can make a big jump. I haven't given up, and I don't want ${o} to either.`,
          `I want ${name} to know that growth takes time, and I see the effort ${s}${ve} been putting in. Let's build on that and make next term even stronger.`,
          `The road has been bumpy, but ${name} ${nhas} shown me flashes of what ${s} ${is_} truly capable of. I want to help ${o} find that consistency. Let's make a plan together.`,
          `I care about ${name}'s success and I want to find the right path forward. With some adjustments and support, I'm confident things will improve.`,
        ],
        early: [
          `We're still getting started, and I'm looking forward to learning more about ${name}'s strengths as the term progresses. The best is yet to come.`,
          `There's so much more to learn about ${name} as a student, and I'm excited to see ${p} profile develop as we get further into the term.`,
          `This is just the beginning, and I'm optimistic about what's ahead for ${name}. Stay tuned.`,
        ],
      };
      p4 += pick(closers[archetype]);

      if (p4.trim()) paras.push(p4.trim());
    }

    // ═══ ASSEMBLE ═══
    // Use <p> tags for contenteditable editor; fallback plain-text also works
    const html = paras.map(p => `<p>${p}</p>`).join('');
    upsertTermRating(cid, sid, termId, { narrative: html });
    rerender();
  }

  function tqSelectStudent(sid) {
    tqSaveCurrentIfNeeded();
    const students = getTqStudents();
    const idx = students.findIndex(s => s.id === sid);
    if (idx >= 0) {
      tqStudentIndex = idx;
      rerender();
    }
  }

  function renderTermQuestionnaire(cid) {
    const students = getTqStudents();
    if (students.length === 0) return '<div class="empty-state"><div class="empty-state-title">No students</div></div>';
    if (tqStudentIndex >= students.length) tqStudentIndex = 0;

    const student = students[tqStudentIndex];
    const sid = student.id;
    const name = displayName(student);
    const fName = esc(fullName(student));
    const termId = getTermId();
    const rating = getStudentTermRating(cid, sid, termId) || {};
    const dims = rating.dims || {};
    const narrative = rating.narrative || '';
    const course = COURSES[cid];

    // Update toolbar student nav
    const navName = document.getElementById('tq-student-name');
    if (navName) navName.textContent = name;
    const completedCount = students.filter(s => {
      const r = getStudentTermRating(cid, s.id, termId);
      return r && OBS_DIMS.some(d => (r.dims?.[d] || 0) > 0);
    }).length;
    const ringFill = document.getElementById('tq-ring-fill');
    const ringLabel = document.getElementById('tq-progress-label');
    if (ringFill && ringLabel) {
      const pct = students.length > 0 ? completedCount / students.length : 0;
      const circumference = 75.4; // 2 * π * 12
      ringFill.style.strokeDashoffset = circumference * (1 - pct);
      ringLabel.textContent = `${completedCount}`;
    }

    // ── Gather all auto-populated data ──
    const overall = getOverallProficiency(cid, sid);
    const sections = getSections(cid);
    const allObs = getStudentQuickObs(cid, sid);
    const allTags = getAllTags(cid);
    const reflections = getReflections(cid);
    const studentReflections = reflections[sid] || {};

    // Observation insights
    const obsCount = allObs.length;
    const sentimentCounts = { strength: 0, growth: 0, concern: 0 };
    const contextCounts = {};
    allObs.forEach(ob => {
      if (ob.sentiment) sentimentCounts[ob.sentiment] = (sentimentCounts[ob.sentiment] || 0) + 1;
      if (ob.context) contextCounts[ob.context] = (contextCounts[ob.context] || 0) + 1;
    });
    const topContext = Object.entries(contextCounts).sort((a, b) => b[1] - a[1])[0];

    // Strengths & growth areas (auto-populated from tag proficiency)
    const tagProfs = allTags
      .map(t => ({ tag: t, prof: getTagProficiency(cid, sid, t.id), section: getSectionForTag(cid, t.id) }))
      .filter(t => t.prof > 0);
    const strengths = tagProfs
      .filter(t => t.prof >= 3)
      .sort((a, b) => b.prof - a.prof)
      .slice(0, 6);
    const growthAreas = tagProfs
      .filter(t => t.prof > 0 && t.prof < 3)
      .sort((a, b) => a.prof - b.prof)
      .slice(0, 6);

    // Per-assignment performance
    const assessments = getAssessments(cid);
    const studentScores = getScores(cid)[sid] || [];
    const assignmentPerf = assessments
      .map(a => {
        const aScores = studentScores.filter(s => s.assessmentId === a.id && s.score > 0);
        const avg = aScores.length > 0 ? aScores.reduce((sum, s) => sum + s.score, 0) / aScores.length : 0;
        return { id: a.id, title: a.title, date: a.date, type: a.type || 'summative', avg, count: aScores.length };
      })
      .filter(a => a.count > 0)
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // Saved quick-profile data
    const workHabits = rating.workHabits || 0;
    const participation = rating.participation || 0;
    const socialTraits = rating.socialTraits || [];
    const savedStrengths = rating.strengths || strengths.map(s => s.tag.id);
    const savedGrowth = rating.growthAreas || growthAreas.map(g => g.tag.id);
    const mentionAssessments = rating.mentionAssessments || [];

    let html = `<div class="tq-wrap">`;

    // ══ HEADER BAR (shared component) ══
    html += renderStudentHeader(cid, sid, {
      buttonLabel: 'Student Dashboard',
      buttonHref: `#/student?course=${cid}&id=${sid}`,
    });

    // ══ ROW 1: Dispositions + Quick Profile (4/4/4) ══
    const PILL_TEXT = { 1: 'Needs Support', 2: 'Developing', 3: 'Growing', 4: 'Thriving' };
    const ratedLearning = LEARNING_DIMS.filter(d => (dims[d] || 0) > 0).length;
    const ratedRelational = RELATIONAL_DIMS.filter(d => (dims[d] || 0) > 0).length;

    const _renderDimPanel = (dimList, title, ratedCount, panelId) => {
      html += `<div class="tq-panel" data-panel-id="${panelId}">
      <div class="tq-panel-title">${title} <span class="tq-panel-badge">${ratedCount}/${dimList.length}</span></div>`;
      dimList.forEach(dim => {
        const val = dims[dim] || 0;
        html += `<div class="tq-dim-row${val > 0 ? ' rated' : ''}">
        <div class="tq-dim-header">
          <span class="tq-dim-icon">${OBS_ICONS[dim]}</span>
          <span class="tq-dim-label">${OBS_LABELS[dim]}</span>
        </div>
        <div class="tq-dim-pills">`;
        [1, 2, 3, 4].forEach(lvl => {
          html += `<button class="tq-pill pill-${lvl}${val === lvl ? ' active' : ''}"
          data-action="tqSetDim" data-sid="${sid}" data-dim="${dim}" data-lvl="${lvl}">${PILL_TEXT[lvl]}</button>`;
        });
        html += `</div>
      </div>`;
      });
      html += `</div>`;
    };
    _renderDimPanel(LEARNING_DIMS, 'Learning Dispositions', ratedLearning, 'learning-dispositions');
    _renderDimPanel(RELATIONAL_DIMS, 'Relational & Identity', ratedRelational, 'relational-identity');

    // Quick Profile
    const RATE_LABELS = { 1: 'Rarely', 2: 'Sometimes', 3: 'Usually', 4: 'Consistently' };
    html += `<div class="tq-panel" data-panel-id="quick-profile">
    <div class="tq-panel-title">Quick Profile</div>`;
    ['workHabits', 'participation'].forEach(field => {
      const val = rating[field] || 0;
      const label = field === 'workHabits' ? 'Work Habits' : 'Participation';
      html += `<div class="tq-rate-row">
      <span class="tq-rate-label">${label}</span>
      <div class="tq-rate-pills">`;
      [1, 2, 3, 4].forEach(lvl => {
        html += `<button class="tq-rate-pill rp-${lvl}${val === lvl ? ' active' : ''}"
        data-action="tqSetField" data-sid="${sid}" data-field="${field}" data-lvl="${lvl}">${RATE_LABELS[lvl]}</button>`;
      });
      html += `</div></div>`;
    });

    // Trait chips
    const SOCIAL_TRAITS = [
      // Positive / character
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
      // Concerns / areas to grow
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
    const CONCERN_IDS = new Set([
      'needs-support',
      'often-late',
      'device-issue',
      'reminders-focus',
      'often-absent',
      'incomplete-work',
      'disorganized',
      'off-task',
      'social-conflicts',
      'low-confidence',
      'avoids-challenges',
      'rushed-work',
    ]);
    const posTraitList = SOCIAL_TRAITS.filter(t => !CONCERN_IDS.has(t.id));
    const negTraitList = SOCIAL_TRAITS.filter(t => CONCERN_IDS.has(t.id));
    html += `<div class="tq-traits-row">
      <span class="tq-traits-label">Traits</span>
      <div class="tq-traits-content">
        <div class="tq-trait-wrap">`;
    posTraitList.forEach(t => {
      html += `<button class="tq-trait-chip${socialTraits.includes(t.id) ? ' active' : ''}"
      data-action="tqToggleTrait" data-sid="${sid}" data-tid="${t.id}">${t.label}</button>`;
    });
    html += `</div>
        <div class="tq-trait-divider"></div>
        <div class="tq-trait-wrap">`;
    negTraitList.forEach(t => {
      html += `<button class="tq-trait-chip concern${socialTraits.includes(t.id) ? ' active' : ''}"
      data-action="tqToggleTrait" data-sid="${sid}" data-tid="${t.id}">${t.label}</button>`;
    });
    html += `</div>
      </div>
    </div></div>`;

    // ══ ROW 2: Observations (full-bleed, span 12) ══
    const mentionObs = rating.mentionObs || [];
    const recentObs = allObs.slice(0, 8);
    const reflectionEntries = Object.entries(studentReflections).filter(([, r]) => r && r.confidence > 0);

    html += `<div class="tq-panel" data-panel-id="observations">
    <div class="tq-panel-title spread">
      <span>Observations <span class="tq-panel-badge">${obsCount}</span></span>
      <div class="tq-obs-summary">`;
    if (sentimentCounts.strength > 0) html += `<div class="tq-obs-stat">✅ ${sentimentCounts.strength}</div>`;
    if (sentimentCounts.growth > 0) html += `<div class="tq-obs-stat">🔄 ${sentimentCounts.growth}</div>`;
    if (sentimentCounts.concern > 0) html += `<div class="tq-obs-stat">⚠️ ${sentimentCounts.concern}</div>`;
    if (topContext)
      html += `<div class="tq-obs-stat">${OBS_CONTEXTS[topContext[0]]?.icon || ''} ${OBS_CONTEXTS[topContext[0]]?.label || topContext[0]}</div>`;
    html += `</div></div>`;

    if (recentObs.length > 0) {
      const hasAssignObs = recentObs.some(o => o.assignmentContext);
      const hasGenObs = recentObs.some(o => !o.assignmentContext);
      if (hasAssignObs && hasGenObs) {
        html += `<div class="tq-obs-filter-bar">
        <button class="tq-obs-filter-btn${_tqObsFilter === 'all' ? ' active' : ''}" data-action="tqObsFilter" data-filter="all">All</button>
        <button class="tq-obs-filter-btn${_tqObsFilter === 'general' ? ' active' : ''}" data-action="tqObsFilter" data-filter="general">General</button>
        <button class="tq-obs-filter-btn${_tqObsFilter === 'assignment' ? ' active' : ''}" data-action="tqObsFilter" data-filter="assignment">Assignment</button>
      </div>`;
      }
      const filteredObs = recentObs.filter(o =>
        _tqObsFilter === 'all' ? true : _tqObsFilter === 'assignment' ? !!o.assignmentContext : !o.assignmentContext,
      );
      html += `<div class="tq-obs-hint">Select to mention in narrative</div>`;
      html += `<div class="tq-evidence-list">`;
      filteredObs.forEach(ob => {
        const d = new Date(ob.created);
        const dateStr = d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
        const sentIcon = ob.sentiment ? (OBS_SENTIMENTS[ob.sentiment]?.icon || '') + ' ' : '';
        const selected = mentionObs.includes(ob.id);
        html += `<div class="tq-evidence-item${selected ? ' selected' : ''}" data-action="tqToggleOb" data-sid="${sid}" data-obid="${ob.id}">
        <span class="tq-tag-check"></span>
        <span class="tq-evidence-text"><span class="tq-evidence-sentiment">${sentIcon}</span>${ob.assignmentContext ? `<span class="tq-obs-assign-tag">${esc(ob.assignmentContext.assessmentTitle)}</span>` : ''}${esc(ob.text)}</span>
        <span class="tq-obs-wide-date">${dateStr}</span>
      </div>`;
      });
      html += `</div>`;
    } else {
      html += `<div class="tq-obs-empty">There are no observations for this student.</div>`;
    }
    html += `</div>`; // close observations panel

    // ══ ROW 3: Academic Snapshot (span 6) + Narrative (span 6) ══
    html += `<div class="tq-panel" data-panel-id="academic-snapshot">
    <div class="tq-panel-title">Academic Snapshot <span class="tq-panel-badge">${assignmentPerf.length} assessed</span></div>
    <div class="tq-snapshot-grid">
      <div class="tq-snapshot-item overall">
        <div class="tq-snapshot-item-label">Overall</div>
        <div class="tq-snapshot-item-value" style="color:${PROF_COLORS[Math.round(overall)] || 'var(--text-3)'};background:${PROF_TINT[Math.round(overall)] || 'transparent'}">${overall > 0 ? PROF_LABELS[Math.round(overall)] : 'No data'}</div>
      </div>`;
    sections.forEach(sec => {
      const prof = getSectionProficiency(cid, sid, sec.id);
      const sr = Math.round(prof);
      html += `<div class="tq-snapshot-item">
      <div class="tq-snapshot-item-label">${esc(sec.shortName || sec.name)}</div>
      <div class="tq-snapshot-item-value" style="color:${PROF_COLORS[sr] || 'var(--text-3)'};background:${PROF_TINT[sr] || 'transparent'}">${prof > 0 ? PROF_LABELS[sr] : '—'}</div>
    </div>`;
    });
    html += `</div>`;

    // Assignment performance rows (toggleable for mention in narrative)
    if (assignmentPerf.length > 0) {
      html += `<div class="tq-assignment-section"><div class="tq-panel-title">Assignments — select to mention</div>
    <div class="tq-assignment-list">`;
      assignmentPerf.forEach(a => {
        const r = Math.round(a.avg);
        const selected = mentionAssessments.includes(a.id);
        html += `<div class="tq-assignment-row${selected ? ' selected' : ''}" data-action="tqToggleAssignment" data-sid="${sid}" data-aid="${a.id}">
        <span class="tq-tag-check">${selected ? '✓' : ''}</span>
        <span class="tq-assignment-title">${esc(a.title)}</span>
        <span class="tq-assignment-type">${a.type === 'formative' ? 'Form' : 'Sum'}</span>
        <span class="tq-assignment-score" style="color:${PROF_COLORS[r] || 'var(--text-3)'}">${PROF_LABELS[r]}</span>
      </div>`;
      });
      html += `</div></div>`;
    }

    // Self-reflections folded into academic-snapshot as a collapsed subsection
    if (reflectionEntries.length > 0) {
      html += `<details class="tq-reflections-subsection">
      <summary>Student Self-Reflections <span class="tq-panel-badge">${reflectionEntries.length}</span></summary>
      <div class="tq-reflections-body">`;
      reflectionEntries.forEach(([secId, ref]) => {
        const sec = sections.find(s => s.id === secId);
        const secName = sec ? sec.shortName || sec.name : secId;
        html += `<div class="tq-reflection-row">
        <span class="tq-reflection-label">${esc(secName)}</span>
        <span class="tq-reflection-val" style="color:${CONFIDENCE_COLORS[ref.confidence]}">${CONFIDENCE_LABELS[ref.confidence]}</span>
      </div>`;
      });
      html += `</div></details>`;
    }
    html += `</div>`; // close academic-snapshot panel

    html += `<div class="tq-panel" data-panel-id="narrative-comment">
    <div class="tq-panel-title">Narrative Comment</div>
    <div class="tq-editor-wrap">
      <div class="tq-toolbar">
        <div class="tq-toolbar-group">
          <button type="button" class="tq-tb-btn" data-action="tqExec" data-cmd="bold" title="Bold (⌘B)"><svg viewBox="0 0 24 24"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg></button>
          <button type="button" class="tq-tb-btn" data-action="tqExec" data-cmd="italic" title="Italic (⌘I)"><svg viewBox="0 0 24 24"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg></button>
          <button type="button" class="tq-tb-btn" data-action="tqExec" data-cmd="underline" title="Underline (⌘U)"><svg viewBox="0 0 24 24"><path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg></button>
        </div>
        <div class="tq-toolbar-group">
          <button type="button" class="tq-tb-btn" data-action="tqExec" data-cmd="insertUnorderedList" title="Bullet List"><svg viewBox="0 0 24 24"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="5" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg></button>
          <button type="button" class="tq-tb-btn" data-action="tqExec" data-cmd="insertOrderedList" title="Numbered List"><svg viewBox="0 0 24 24"><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><text x="4" y="8" font-size="7" fill="currentColor" stroke="none" font-weight="600">1</text><text x="4" y="14" font-size="7" fill="currentColor" stroke="none" font-weight="600">2</text><text x="4" y="20" font-size="7" fill="currentColor" stroke="none" font-weight="600">3</text></svg></button>
        </div>
        <div class="tq-toolbar-group">
          <button type="button" class="tq-tb-btn" data-action="tqExec" data-cmd="removeFormat" title="Clear Formatting"><svg viewBox="0 0 24 24"><path d="M17 4H7"/><path d="M12 4v7"/><path d="M4 20l16-16"/></svg></button>
        </div>
        ${
          _SHOW_AUTO_NARRATIVE
            ? `<button type="button" class="tq-tb-btn tq-tb-auto" data-action="tqAutoNarrative" data-sid="${sid}" title="Auto-generate from profile data" id="tq-auto-btn">
          <svg viewBox="0 0 24 24"><path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" fill="currentColor" stroke="none" opacity="0.7"/></svg>
          <span>Generate</span>
        </button>`
            : ''
        }
        <button type="button" class="tq-tb-btn tq-tb-copy" data-action="tqCopyNarrative" title="Copy to Clipboard" id="tq-copy-btn">
          <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          <span>Copy</span>
        </button>
      </div>
      <div class="tq-narrative-editor" id="tq-narrative" contenteditable="true"
        data-placeholder="Write about ${esc(name)}'s learning dispositions, work habits, and growth…"
        oninput="window._tqMarkDirty&&window._tqMarkDirty()">${sanitizeHtml(narrative || '')}</div>
    </div>
  </div>`; // close narrative-comment panel

    // ══ NAV FOOTER (full-width) ══
    html += `<div class="tq-nav-footer">
    <button class="tq-nav-btn" data-action="tqPrevStudent" ${tqStudentIndex === 0 ? 'disabled' : ''}>← Previous</button>
    <span class="tq-nav-counter">${tqStudentIndex + 1} of ${students.length}</span>
    <button class="tq-nav-btn primary" data-action="tqNextStudent">${tqStudentIndex >= students.length - 1 ? 'Done ✓' : 'Save & Next →'}</button>
  </div>`;

    html += `</div>`; // close tq-wrap
    return html;
  }

  /* ── Namespace ──────────────────────────────────────────── */
  return {
    configure: configure,
    getTqStudents: getTqStudents,
    tqPrevStudent: tqPrevStudent,
    tqNextStudent: tqNextStudent,
    tqSaveCurrentIfNeeded: tqSaveCurrentIfNeeded,
    tqSaveNarrative: tqSaveNarrative,
    tqExec: tqExec,
    tqUpdateToolbar: tqUpdateToolbar,
    tqCopyNarrative: tqCopyNarrative,
    tqSetDim: tqSetDim,
    tqSetField: tqSetField,
    tqToggleTrait: tqToggleTrait,
    tqToggleAssignment: tqToggleAssignment,
    tqToggleOb: tqToggleOb,
    tqAutoNarrative: tqAutoNarrative,
    tqSelectStudent: tqSelectStudent,
    renderTermQuestionnaire: renderTermQuestionnaire,
    get tqStudentIndex() {
      return tqStudentIndex;
    },
    set tqStudentIndex(v) {
      tqStudentIndex = v;
    },
    get tqNarrativeDirty() {
      return tqNarrativeDirty;
    },
    set tqNarrativeDirty(v) {
      tqNarrativeDirty = v;
    },
    get tqObsFilter() {
      return _tqObsFilter;
    },
    set tqObsFilter(v) {
      _tqObsFilter = v;
    },
  };
})();
