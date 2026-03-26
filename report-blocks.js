/* == report-blocks.js -- Report block renderers ================ */
window.ReportBlocks = (function() {
  'use strict';

  /* ── Pronoun helpers ─────────────────────────────────────────── */
  function getPronouns(student) {
    var p = (student.pronouns || 'they/them').toLowerCase().split('/');
    var subj = p[0] || 'they';
    var obj = p[1] || 'them';
    var poss, refl, verb;
    if (subj === 'she') { poss = 'her'; refl = 'herself'; verb = 's'; }
    else if (subj === 'he') { poss = 'his'; refl = 'himself'; verb = 's'; }
    else { poss = 'their'; refl = 'themselves'; verb = ''; }
    return { subj: subj, obj: obj, poss: poss, refl: refl, verb: verb, capSubj: subj[0].toUpperCase() + subj.slice(1) };
  }

  /* ── Observation descriptors (shared with narrative) ── */
  var OBS_DESCRIPTORS = {
    engagement:      { prompt:'I participate actively and stay focused on my learning', desc:'Active participation and focus in learning', example:'Stays on task, asks questions, contributes ideas' },
    collaboration:   { prompt:'I work well with others and support my group', desc:'Working effectively with others', example:'Shares ideas, listens to peers, supports group goals' },
    selfRegulation:  { prompt:'I manage my time, stay organized, and handle my emotions', desc:'Managing time, emotions, and work habits', example:'Plans ahead, handles setbacks, stays organized' },
    resilience:      { prompt:'I keep trying when things are difficult', desc:'Persevering through challenges', example:'Tries again after mistakes, seeks help, doesn\'t give up' },
    curiosity:       { prompt:'I explore new ideas and take risks in my thinking', desc:'Exploring ideas and taking intellectual risks', example:'Asks "what if?", tries new approaches, goes deeper' },
    respect:         { prompt:'I show care for my classmates and our community', desc:'Showing care for others and the community', example:'Kind words, active listening, inclusive behavior' }
  };

  /* ── Sanitize narrative HTML (delegates to shared sanitizeHtml in gb-ui.js) ── */
  function sanitizeNarrativeHtml(raw) { return sanitizeHtml(raw); }

  /* ══════════════════════════════════════════════════════════════
     REPORT BLOCK RENDERERS
     ══════════════════════════════════════════════════════════════ */

  function renderBlockHeader(cid, student) {
    var course = COURSES[cid];
    var period = document.getElementById('report-period').value;
    return '<div class="report-header">' +
      '<div class="report-course-title">' + esc(course.name) + ' Student Learning Report</div>' +
      '<div class="report-student-name">' + esc(fullName(student)) + (student.studentNumber ? ' <span style="font-size:0.7em;color:var(--text-3);font-weight:400">(' + esc(student.studentNumber) + ')</span>' : '') + '</div>' +
      '<div class="report-period">' + esc(period) + '</div>' +
    '</div>';
  }

  function renderBlockAcademicSummary(cid, student) {
    var sections = getSections(cid);
    var overall = getOverallProficiency(cid, student.id);
    var overallRound = Math.round(overall);
    var cc = getCourseConfig(cid);
    var usePercentage = cc.reportAsPercentage || false;
    var overallDisplay, overallHeading;
    if (usePercentage && overall > 0) {
      var letterData = calcLetterGrade(overall);
      overallDisplay = letterData ? letterData.pct + '%' : Math.round((overall / 4) * 100) + '%';
      overallHeading = 'Overall Grade';
    } else {
      overallDisplay = overall > 0 ? PROF_LABELS[overallRound] : 'No Evidence';
      overallHeading = 'Overall Proficiency';
    }
    var html = '<div class="report-overall">' +
      '<div class="report-overall-main">' +
        '<div class="report-overall-label">' + overallHeading + '</div>' +
        '<div class="report-overall-word">' + overallDisplay + '</div>' +
      '</div>' +
      '<div class="report-overall-sections">';
    var _rbGrouped = getGroupedSections(cid);
    var _rbChip = function(name, prof, color) {
      var sr = Math.round(prof);
      var slabel = prof > 0 ? PROF_LABELS[sr] : 'No Evidence';
      var scolor = PROF_COLORS[sr] || PROF_COLORS[0];
      return '<div class="report-section-chip">' +
        '<div class="report-section-chip-name" style="color:' + color + '">' + esc(name) + '</div>' +
        '<div class="report-section-chip-value" data-prof="' + sr + '" style="color:' + scolor + '">' + slabel + '</div>' +
      '</div>';
    };
    if (_rbGrouped.groups.some(function(gi) { return gi.sections.length > 0; })) {
      // One chip per group (averaged) + one per ungrouped section
      _rbGrouped.groups.forEach(function(gi) {
        if (gi.sections.length === 0) return;
        var gp = getGroupProficiency(cid, student.id, gi.group.id);
        html += _rbChip(gi.group.name, gp, gi.group.color);
      });
      _rbGrouped.ungrouped.forEach(function(sec) {
        var sp = getSectionProficiency(cid, student.id, sec.id);
        html += _rbChip(sec.shortName || sec.name, sp, sec.color);
      });
    } else {
      sections.forEach(function(sec) {
        var sp = getSectionProficiency(cid, student.id, sec.id);
        html += _rbChip(sec.shortName || sec.name, sp, sec.color);
      });
    }
    html += '</div></div>';
    return html;
  }

  function renderBlockLearnerDimensions(cid, student) {
    var termId = window.ReportNarrative.getTermId();
    var rating = getStudentTermRating(cid, student.id, termId);
    if (!rating) return '';
    var dims = rating.dims || {};
    var html = '<div class="report-learner-profile">';
    html += '<div class="report-learner-title">\uD83D\uDC41 Disposition Dimensions</div>';
    html += '<div class="report-learner-dims">';
    OBS_DIMS.forEach(function(dim) {
      var val = dims[dim] || 0;
      var pct = val > 0 ? (val / 4 * 100) : 0;
      var label = val > 0 ? OBS_LEVEL_LABELS[val] : 'Not Assessed';
      var color = val > 0 ? OBS_LEVEL_COLORS[val] : 'var(--text-3)';
      var info = OBS_DESCRIPTORS[dim] || {};
      html += '<div class="report-learner-dim">' +
        '<span class="report-learner-dim-icon">' + OBS_ICONS[dim] + '</span>' +
        '<div class="report-learner-dim-info">' +
          '<div class="report-learner-dim-label">' + OBS_LABELS[dim] + '</div>' +
          '<div class="report-dim-desc">' + (info.desc || '') + '</div>' +
          '<div class="report-dim-example">e.g. ' + (info.example || '') + '</div>' +
          '<div class="report-learner-dim-value" data-prof="' + val + '" style="color:' + color + ';margin-top:4px">' + label + '</div>' +
          '<div class="report-learner-dim-bar">' +
            '<div class="report-learner-dim-fill" data-prof-bg="' + val + '" style="width:' + pct + '%;background:' + color + '"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    });
    html += '</div></div>';
    return html;
  }

  function renderBlockTeacherNarrative(cid, student) {
    var termId = window.ReportNarrative.getTermId();
    var rating = getStudentTermRating(cid, student.id, termId);
    if (!rating || !rating.narrative || !rating.narrative.trim()) return '';
    var isHtml = /<[a-z][\s\S]*>/i.test(rating.narrative);
    var content = isHtml ? sanitizeNarrativeHtml(rating.narrative.trim()) : esc(rating.narrative.trim());
    var html = '<div class="report-block-box" style="page-break-inside:avoid">';
    html += '<div class="report-block-title">Teacher Comment</div>';
    html += '<div style="font-size:0.88rem;color:var(--text);line-height:1.6;padding:4px 0">' + content + '</div>';
    html += '</div>';
    return html;
  }

  function renderBlockObservations(cid, student) {
    var quickObs = getStudentQuickObs(cid, student.id);
    var recentObs = quickObs.slice(0, 5);
    if (recentObs.length === 0) return '';
    var html = '<div class="report-learner-profile">';
    html += '<div class="report-learner-title">\uD83D\uDCDD Observation Evidence</div>';
    html += '<div class="report-obs-notes">';
    recentObs.forEach(function(ob) {
      var dimPills = (ob.dims || []).map(function(d) {
        var info = resolveTag(d);
        return '<span style="display:inline-flex;align-items:center;gap:3px;font-size:0.62rem;padding:1px 6px;border-radius:8px;background:rgba(0,0,0,0.05);color:#555;margin-left:4px;"><span style="width:5px;height:5px;border-radius:50%;background:' + info.color + ';display:inline-block;"></span>' + esc(info.label) + '</span>';
      }).join('');
      var assignPill = ob.assignmentContext ? '<span style="font-size:0.55rem;font-weight:600;color:var(--active);background:rgba(0,122,255,0.08);padding:1px 6px;border-radius:8px;margin-right:4px">' + esc(ob.assignmentContext.assessmentTitle) + '</span>' : '';
      html += '<div class="report-obs-note">' + assignPill + esc(ob.text) + dimPills +
        '<div class="report-obs-note-date">' + formatDate(ob.created || ob.date) + '</div>' +
      '</div>';
    });
    html += '</div></div>';
    return html;
  }

  function renderBlockSectionOutcomes(cid, student) {
    var sections = getSections(cid);
    var assessments = getAssessments(cid);
    var allScores = getScores(cid)[student.id] || [];
    var html = '<div class="report-block-box">' +
      '<div class="report-block-title">Learning Outcomes</div>';
    sections.forEach(function(sec) {
      var secProf = getSectionProficiency(cid, student.id, sec.id);
      var sr = Math.round(secProf);
      var secOverride = getSectionOverride(cid, student.id, sec.id);
      html += '<div class="report-outcome-section" style="page-break-inside:avoid">' +
        '<div class="report-outcome-section-header" style="display:flex;align-items:center;justify-content:space-between">' +
          '<span>' + esc(sec.shortName || sec.name) + '</span>';
      if (secProf > 0) {
        html += '<span data-prof="' + sr + '" style="font-size:0.68rem;font-weight:600;color:' + PROF_COLORS[sr] + '">' + PROF_LABELS[sr] + '</span>';
      }
      html += '</div>';
      if (secOverride) {
        html += '<div style="font-size:0.62rem;color:var(--text-3);font-style:italic;margin:2px 0 6px;padding-left:2px">Teacher override (calculated: ' + secOverride.calculated + ' ' + (PROF_LABELS[Math.round(secOverride.calculated)] || '') + '): ' + esc(secOverride.reason) + '</div>';
      }
      var tag = sec.tags[0];
      if (tag) {
        var prof = getTagProficiency(cid, student.id, tag.id);
        var r = Math.round(prof);
        var color = PROF_COLORS[r] || PROF_COLORS[0];
        var tint = PROF_TINT[r] || PROF_TINT[0];
        var label = prof > 0 ? PROF_LABELS[r] : 'Not yet assessed';
        var barPct = prof > 0 ? (prof / 4 * 100) : 0;
        var tagScores = allScores.filter(function(s) { return s.tagId === tag.id && s.score > 0; });
        var evidenceMap = {};
        tagScores.forEach(function(s) {
          if (!evidenceMap[s.assessmentId]) evidenceMap[s.assessmentId] = [];
          evidenceMap[s.assessmentId].push(s.score);
        });
        var evidence = Object.keys(evidenceMap).map(function(aId) {
          var a = assessments.find(function(x) { return x.id === aId; });
          if (!a) return null;
          var avg = evidenceMap[aId].reduce(function(s,x) { return s+x; }, 0) / evidenceMap[aId].length;
          var ar = Math.round(avg);
          return { title: a.title, r: ar, label: (PROF_LABELS[ar]||'?') };
        }).filter(Boolean);
        html += '<div class="report-outcome-row">' +
          '<div class="report-outcome-info">' +
            '<div class="report-outcome-label">' + esc(tag.label || tag.text) + '</div>';
        if (evidence.length > 0) {
          var evStr = evidence.map(function(e) {
            return '<span class="report-outcome-ev" data-prof="' + e.r + '" style="color:' + (PROF_COLORS[e.r]||'var(--text-3)') + '">' + esc(e.title) + '\u2009<span style="font-weight:600">[' + e.label[0] + ']</span></span>';
          }).join('<span style="color:var(--text-3);margin:0 3px">\u00b7</span>');
          html += '<div class="report-outcome-evidence">' + evStr + '</div>';
        }
        if (tag.text && tag.text !== tag.label) {
          html += '<div class="report-outcome-statement">' + esc(tag.text) + '</div>';
        }
        if (tag.i_can_statements && tag.i_can_statements.length > 0) {
          html += '<ul class="report-ican-list">';
          tag.i_can_statements.forEach(function(stmt) {
            html += '<li class="report-ican-item">' + esc(stmt) + '</li>';
          });
          html += '</ul>';
        }
        html += '</div>' +
          '<div class="report-outcome-status">' +
            '<div class="report-outcome-bar"><div class="report-outcome-bar-fill" data-prof-bg="' + r + '" style="width:' + barPct + '%;background:' + color + '"></div></div>' +
            '<span class="report-outcome-pill" data-prof="' + r + '" data-prof-bg="' + r + '" style="background:' + (prof > 0 ? tint : 'rgba(0,0,0,0.04)') + ';color:' + (prof > 0 ? color : 'var(--text-3)') + '">' + label + '</span>' +
          '</div>' +
        '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderBlockNextSteps(cid, student) {
    var focusAreas = getFocusAreas(cid, student.id, 3);
    var realFocus = focusAreas.filter(function(f) { return f.prof <= 2; });
    if (realFocus.length === 0) return '';
    var html = '<div class="report-next-steps"><div class="report-next-steps-title">Suggested Next Steps</div>';
    realFocus.forEach(function(f, i) {
      var secName = f.section ? f.section.name : '';
      var profLabel = f.prof > 0 ? PROF_LABELS[Math.round(f.prof)] : 'No Evidence';
      var profColor = PROF_COLORS[Math.round(f.prof)] || PROF_COLORS[0];
      var nextStepDesc = '<strong>' + esc(secName) + '</strong> &mdash; ' + esc(f.tag.label) + ': ' + esc(profLabel) + '.';
      if (f.tag.i_can_statements && f.tag.i_can_statements.length > 0) {
        nextStepDesc += ' <span style="color:var(--text-2)">Focus areas:</span>';
        nextStepDesc += '<ul class="report-ican-list" style="margin-top:4px">';
        f.tag.i_can_statements.forEach(function(stmt) {
          nextStepDesc += '<li class="report-ican-item">' + esc(stmt) + '</li>';
        });
        nextStepDesc += '</ul>';
      } else {
        nextStepDesc += ' Continue building skills in this area.';
      }
      html += '<div class="report-next-step-item">' +
        '<div class="report-next-step-bullet" data-prof-bg="' + Math.round(f.prof) + '" style="background:' + profColor + '">' + (i + 1) + '</div>' +
        '<div>' + nextStepDesc + '</div>' +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderBlockLegend() {
    return '<div class="report-legend">' +
      '<div class="report-legend-item"><span class="report-legend-dot" data-prof-bg="1" style="background:var(--score-1)"></span><div class="report-legend-text"><span class="report-legend-word">Emerging</span><span class="report-legend-desc">Beginning to develop understanding; requires consistent support</span></div></div>' +
      '<div class="report-legend-item"><span class="report-legend-dot" data-prof-bg="2" style="background:var(--score-2)"></span><div class="report-legend-text"><span class="report-legend-word">Developing</span><span class="report-legend-desc">Growing understanding; demonstrates learning with some support</span></div></div>' +
      '<div class="report-legend-item"><span class="report-legend-dot" data-prof-bg="3" style="background:var(--score-3)"></span><div class="report-legend-text"><span class="report-legend-word">Proficient</span><span class="report-legend-desc">Solid, independent understanding of grade-level expectations</span></div></div>' +
      '<div class="report-legend-item"><span class="report-legend-dot" data-prof-bg="4" style="background:var(--score-4)"></span><div class="report-legend-text"><span class="report-legend-word">Extending</span><span class="report-legend-desc">Deep, sophisticated understanding; applies learning in new contexts</span></div></div>' +
    '</div>';
  }

  function renderBlockParentResponse(cid, student) {
    var html = '<div class="report-block-box report-parent-response">';
    html += '<div class="report-block-title">Parent / Guardian Response</div>';
    html += '<div style="font-size:0.78rem;color:var(--text-2);margin-bottom:14px;line-height:1.5">Please review this report with your child and return this section to the school.</div>';
    html += '<div class="report-parent-lines">' +
      '<div class="report-parent-line"><span class="report-parent-label">Signature</span><span class="report-parent-field"></span></div>' +
      '<div class="report-parent-line" style="max-width:180px"><span class="report-parent-label">Date</span><span class="report-parent-field"></span></div>' +
    '</div>';
    html += '<div class="report-parent-lines">' +
      '<div class="report-parent-line"><span class="report-parent-label">Phone</span><span class="report-parent-field"></span></div>' +
      '<div class="report-parent-line"><span class="report-parent-label">Email</span><span class="report-parent-field"></span></div>' +
    '</div>';
    html += '<div class="report-parent-checks">' +
      '<div class="report-parent-check"><span class="report-parent-checkbox"></span> I have reviewed this report with my child</div>' +
      '<div class="report-parent-check"><span class="report-parent-checkbox"></span> I would like to schedule a meeting with the teacher</div>' +
      '<div class="report-parent-check"><span class="report-parent-checkbox"></span> I have questions about my child\'s progress</div>' +
    '</div>';
    html += '<div style="margin-top:14px">' +
      '<div class="report-parent-label" style="margin-bottom:6px">Comments or Questions</div>' +
      '<div style="border:1.5px solid var(--border);border-radius:8px;min-height:60px;padding:8px"></div>' +
    '</div>';
    html += '</div>';
    return html;
  }

  function renderBlockStudentReflectionLearning(cid, student) {
    var name = esc(displayNameFirst(student));
    var scale = ['Rarely', 'Sometimes', 'Usually', 'Consistently'];
    var html = '<div class="report-block-box" style="page-break-inside:avoid">';
    html += '<div class="report-block-title">How I See Myself as a Learner</div>';
    html += '<div style="font-size:0.76rem;color:var(--text-2);margin-bottom:12px">' + name + ', rate yourself honestly on each learning disposition. Fill in one circle per row.</div>';
    html += '<div style="display:flex;justify-content:flex-end;gap:0;margin-bottom:4px;padding-right:4px">';
    scale.forEach(function(s) { html += '<span style="width:68px;text-align:center;font-size:0.56rem;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;color:var(--text-3)">' + s + '</span>'; });
    html += '</div>';
    OBS_DIMS.forEach(function(dim) {
      var info = OBS_DESCRIPTORS[dim];
      html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid rgba(0,0,0,0.04)">' +
        '<span style="font-size:1.1rem;flex-shrink:0">' + OBS_ICONS[dim] + '</span>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:0.82rem;font-weight:700;color:var(--text)">' + OBS_LABELS[dim] + '</div>' +
          '<div style="font-size:0.7rem;color:var(--text-2);font-style:italic;line-height:1.3">' + info.prompt + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:0;flex-shrink:0">';
      scale.forEach(function() { html += '<span style="width:68px;display:flex;justify-content:center"><span class="report-reflect-bubble"></span></span>'; });
      html += '</div></div>';
    });
    html += '<div class="report-reflect-open" style="margin-top:16px;padding-top:14px;border-top:1.5px solid var(--border)">' +
      '<div class="report-reflect-open-line"><span class="report-reflect-open-label">My biggest strength as a learner:</span><span class="report-reflect-open-field"></span></div>' +
      '<div class="report-reflect-open-line"><span class="report-reflect-open-label">One thing I want to work on:</span><span class="report-reflect-open-field"></span></div>' +
      '<div class="report-reflect-open-line"><span class="report-reflect-open-label">What helps me learn best:</span><span class="report-reflect-open-field"></span></div>' +
    '</div>';
    html += '</div>';
    return html;
  }

  function renderBlockStudentReflectionHabits(cid, student) {
    var name = esc(displayNameFirst(student));
    var habits = [
      { icon:'\uD83D\uDCC5', text:'I arrive to class on time' },
      { icon:'\uD83D\uDCCB', text:'I come prepared with materials' },
      { icon:'\u270B', text:'I participate in class discussions' },
      { icon:'\uD83D\uDCDD', text:'I hand in assignments on time' },
      { icon:'\uD83D\uDD04', text:'When I miss class, I check in and catch up' },
      { icon:'\uD83E\uDD1D', text:'I am respectful to classmates and teachers' },
      { icon:'\uD83D\uDCF1', text:'I manage distractions (phone, talking, etc.)' },
      { icon:'\uD83D\uDCAA', text:'I put my best effort into my work' },
    ];
    var scale = ['Needs Work', 'Getting There', 'Good', 'Great'];
    var checks = [
      { text:'Missed more than 3 classes', icon:'\uD83D\uDCC9' },
      { text:'Was late more than 3 times', icon:'\u23F0' },
      { text:'Had missing assignments', icon:'\uD83D\uDCC2' },
      { text:'Asked for help when I needed it', icon:'\uD83D\uDE4B' },
      { text:'Used feedback to improve my work', icon:'\uD83D\uDD01' },
      { text:'Set a goal and worked toward it', icon:'\uD83C\uDFAF' },
    ];
    var html = '<div class="report-block-box" style="page-break-inside:avoid">';
    html += '<div class="report-block-title">My Classroom Habits & Responsibilities</div>';
    html += '<div style="font-size:0.76rem;color:var(--text-2);margin-bottom:12px">' + name + ', think honestly about your habits this term. Fill in one circle per row.</div>';
    html += '<table class="report-habits-table"><thead><tr><th></th>';
    scale.forEach(function(s) { html += '<th>' + s + '</th>'; });
    html += '</tr></thead><tbody>';
    habits.forEach(function(h) {
      html += '<tr><td>' + h.icon + ' ' + h.text + '</td>';
      scale.forEach(function() { html += '<td><span class="report-habits-bubble"></span></td>'; });
      html += '</tr>';
    });
    html += '</tbody></table>';
    html += '<div style="margin-top:14px;padding-top:12px;border-top:1.5px solid var(--border)">' +
      '<div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-2);margin-bottom:10px">This term, I\u2026</div>' +
      '<div class="report-habits-checks">';
    checks.forEach(function(c) {
      html += '<div class="report-parent-check"><span class="report-parent-checkbox"></span> ' + c.icon + ' ' + c.text + '</div>';
    });
    html += '</div></div>';
    html += '<div style="margin-top:14px;padding-top:12px;border-top:1.5px solid var(--border)">' +
      '<div class="report-reflect-open-line"><span class="report-reflect-open-label">One habit I\'m proud of:</span><span class="report-reflect-open-field"></span></div>' +
      '<div class="report-reflect-open-line"><span class="report-reflect-open-label">One habit I want to improve:</span><span class="report-reflect-open-field"></span></div>' +
    '</div>';
    html += '</div>';
    return html;
  }

  function renderBlockSectionChart(cid, student) {
    var sections = getSections(cid);
    var assessments = getAssessments(cid);
    var allScores = getScores(cid)[student.id] || [];
    var html = '<div class="report-block-box" style="page-break-inside:avoid">' +
      '<div class="report-block-title">Section Proficiency Breakdown</div>';

    sections.forEach(function(sec, si) {
      var secProf = getSectionProficiency(cid, student.id, sec.id);
      var sr = Math.round(secProf);
      var secLabel = secProf > 0 ? PROF_LABELS[sr] : 'No Evidence';

      var tagData = sec.tags.map(function(tag) {
        var prof = getTagProficiency(cid, student.id, tag.id);
        var r = Math.round(prof);
        return { tag: tag, prof: prof, r: r };
      });
      var assessed = tagData.filter(function(t) { return t.prof > 0; });
      var strengths = assessed.filter(function(t) { return t.r >= 3; }).sort(function(a,b) { return b.prof - a.prof; });
      var growth = assessed.filter(function(t) { return t.r <= 2; }).sort(function(a,b) { return a.prof - b.prof; });
      var notYet = tagData.filter(function(t) { return t.prof === 0; });

      var secTagIds = new Set(sec.tags.map(function(t) { return t.id; }));
      var secScores = allScores.filter(function(s) { return secTagIds.has(s.tagId) && s.score > 0; });
      var touchedAssessIds = new Set(secScores.map(function(s) { return s.assessmentId; }));
      var touchedAssess = assessments.filter(function(a) { return touchedAssessIds.has(a.id); });
      var assessPerf = touchedAssess.map(function(a) {
        var aScores = secScores.filter(function(s) { return s.assessmentId === a.id; });
        if (aScores.length === 0) return null;
        var avg = aScores.reduce(function(s,x) { return s + x.score; }, 0) / aScores.length;
        return { title: a.title, avg: avg, r: Math.round(avg) };
      }).filter(Boolean).sort(function(a,b) { return b.avg - a.avg; });
      var missingAssess = assessments.filter(function(a) {
        var hasTags = (a.tagIds || []).some(function(tid) { return secTagIds.has(tid); });
        if (!hasTags) return false;
        return !allScores.some(function(s) { return s.assessmentId === a.id && secTagIds.has(s.tagId) && s.score > 0; });
      });

      var dots = '';
      for (var i = 1; i <= 4; i++) {
        var filled = secProf > 0 && i <= sr;
        dots += '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;border:1.5px solid ' + (secProf > 0 ? '#333' : '#ccc') + ';' + (filled ? 'background:#333;' : '') + 'margin-right:3px"></span>';
      }

      html += '<div style="' + (si > 0 ? 'margin-top:12px;padding-top:10px;border-top:1.5px solid var(--border);' : '') + 'page-break-inside:avoid">';
      html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:5px">' +
        '<div style="font-size:0.88rem;font-weight:700;color:var(--text);flex:1">' + esc(sec.shortName || sec.name) + '</div>' +
        '<div style="display:flex;align-items:center;gap:2px">' + dots + '</div>' +
        '<div style="font-size:0.82rem;font-weight:700;color:var(--text)">' + secLabel + '</div>' +
        '<div style="font-size:0.64rem;color:var(--text-3);font-weight:500">' + assessed.length + '/' + tagData.length + ' outcomes</div>' +
      '</div>';

      html += '<div style="display:flex;gap:14px;font-size:0.76rem;line-height:1.55">';

      // Col 1: Strengths
      html += '<div style="flex:1;min-width:0">';
      html += '<div style="font-weight:700;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-2);margin-bottom:2px">Strengths</div>';
      if (strengths.length > 0) {
        strengths.forEach(function(t) {
          html += '<div style="display:flex;align-items:baseline;gap:4px;color:var(--text)">' +
            '<span style="font-size:0.64rem;font-weight:600;color:var(--text-3);flex-shrink:0">' + (PROF_LABELS[t.r]||'?')[0] + '</span>' +
            '<span>' + esc(t.tag.label) + '</span>' +
          '</div>';
        });
      } else {
        html += '<div style="color:var(--text-3);font-style:italic;font-size:0.72rem">None yet</div>';
      }
      html += '</div>';

      // Col 2: Growth
      html += '<div style="flex:1;min-width:0">';
      html += '<div style="font-weight:700;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-2);margin-bottom:2px">Areas for Growth</div>';
      if (growth.length > 0) {
        growth.forEach(function(t) {
          html += '<div style="display:flex;align-items:baseline;gap:4px;color:var(--text)">' +
            '<span style="font-size:0.64rem;font-weight:600;color:var(--text-3);flex-shrink:0">' + (PROF_LABELS[t.r]||'?')[0] + '</span>' +
            '<span>' + esc(t.tag.label) + '</span>' +
          '</div>';
        });
      } else if (assessed.length > 0) {
        html += '<div style="color:var(--text-3);font-style:italic;font-size:0.72rem">All at/above proficient</div>';
      }
      if (notYet.length > 0) {
        html += '<div style="font-size:0.66rem;color:var(--text-3);margin-top:2px;font-style:italic">' + notYet.length + ' not yet assessed</div>';
      }
      html += '</div>';

      // Col 3: Assessments
      html += '<div style="flex:1;min-width:0">';
      html += '<div style="font-weight:700;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-2);margin-bottom:2px">Assessments</div>';
      if (assessPerf.length > 0) {
        assessPerf.slice(0, 4).forEach(function(a) {
          html += '<div style="display:flex;align-items:baseline;gap:4px;color:var(--text)">' +
            '<span style="font-size:0.64rem;font-weight:600;color:var(--text-3);flex-shrink:0">' + (PROF_LABELS[a.r]||'?')[0] + '</span>' +
            '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(a.title) + '</span>' +
          '</div>';
        });
        if (assessPerf.length > 4) {
          html += '<div style="font-size:0.64rem;color:var(--text-3);font-style:italic">+' + (assessPerf.length - 4) + ' more</div>';
        }
      } else {
        html += '<div style="color:var(--text-3);font-style:italic;font-size:0.72rem">No evidence yet</div>';
      }
      if (missingAssess.length > 0) {
        html += '<div class="report-missing-title" style="font-size:0.64rem;color:var(--score-1);font-weight:600;margin-top:3px">Missing:</div>';
        missingAssess.slice(0, 3).forEach(function(a) {
          html += '<div style="font-size:0.68rem;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\u00b7 ' + esc(a.title) + '</div>';
        });
        if (missingAssess.length > 3) {
          html += '<div style="font-size:0.64rem;color:var(--text-3);font-style:italic">+' + (missingAssess.length - 3) + ' more</div>';
        }
      }
      html += '</div>';

      html += '</div>'; // close 3-col
      html += '</div>'; // close section
    });

    html += '</div>';
    return html;
  }

  function renderBlockScoreDistribution(cid, student) {
    var allScores = getScores(cid)[student.id] || [];
    var assessments = getAssessments(cid);
    var scored = allScores.filter(function(s) { return s.score > 0; });
    if (scored.length === 0) return '';

    var counts = { 1:0, 2:0, 3:0, 4:0 };
    scored.forEach(function(s) { if (s.score >= 1 && s.score <= 4) counts[s.score]++; });
    var total = scored.length;
    var rawColors = { 1:'#d32f2f', 2:'#c07a00', 3:'#2e7d32', 4:'#1565c0' };

    var cx = 50, cy = 50, r = 40, inner = 24;
    var circ = 2 * Math.PI * r;
    var offset = 0;
    var arcs = '';
    [1,2,3,4].forEach(function(level) {
      if (counts[level] === 0) return;
      var pct = counts[level] / total;
      var dash = circ * pct;
      var gap = circ - dash;
      arcs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + rawColors[level] + '" stroke-width="14"' +
        ' data-prof-stroke="' + level + '" stroke-dasharray="' + dash + ' ' + gap + '" stroke-dashoffset="' + (-offset) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
      offset += dash;
    });

    var assessAvgs = assessments.map(function(a) {
      var aScores = allScores.filter(function(s) { return s.assessmentId === a.id && s.score > 0; });
      if (aScores.length === 0) return null;
      var avg = aScores.reduce(function(s, x) { return s + x.score; }, 0) / aScores.length;
      return { title: a.title, avg: avg, r: Math.round(avg), type: a.type, id: a.id };
    }).filter(Boolean);
    var sorted = assessAvgs.slice().sort(function(a, b) { return b.avg - a.avg; });
    var top = sorted.filter(function(a) { return a.r >= 3; }).slice(0, 3);
    var bottom = sorted.filter(function(a) { return a.r <= 2; }).reverse().slice(0, 3);

    var missing = assessments.filter(function(a) {
      var aScores = allScores.filter(function(s) { return s.assessmentId === a.id && s.score > 0; });
      return aScores.length === 0;
    });

    var profPlus = counts[3] + counts[4];
    var profPct = total > 0 ? Math.round(profPlus / total * 100) : 0;
    var gaugeR = 40, gaugeCirc = 2 * Math.PI * gaugeR;
    var gaugeDash = gaugeCirc * (profPct / 100);

    var html = '<div class="report-block-box" style="page-break-inside:avoid">' +
      '<div class="report-block-title">Score Distribution & Highlights</div>' +
      '<div style="display:flex;gap:16px;padding:4px 0">';

    // LEFT HALF
    html += '<div style="flex:1;min-width:0">' +
      '<div style="display:flex;align-items:center;gap:14px;margin-bottom:8px">' +
        '<svg width="100" height="100" viewBox="0 0 100 100" style="flex-shrink:0">' +
          arcs +
          '<circle cx="' + cx + '" cy="' + cy + '" r="' + inner + '" fill="#fff"/>' +
          '<text x="' + cx + '" y="' + (cy - 3) + '" text-anchor="middle" style="font-size:16px;font-weight:800;fill:var(--text)">' + total + '</text>' +
          '<text x="' + cx + '" y="' + (cy + 8) + '" text-anchor="middle" style="font-size:6.5px;fill:var(--text-3);text-transform:uppercase;letter-spacing:0.5px">scores</text>' +
        '</svg>' +
        '<div style="display:flex;flex-direction:column;gap:4px;flex:1">';
    [4,3,2,1].forEach(function(level) {
      var pct = total > 0 ? Math.round(counts[level] / total * 100) : 0;
      html += '<div style="display:flex;align-items:center;gap:6px">' +
        '<span data-prof-bg="' + level + '" style="width:7px;height:7px;border-radius:50%;background:' + rawColors[level] + ';flex-shrink:0"></span>' +
        '<span style="font-size:0.68rem;font-weight:600;color:var(--text);width:65px">' + PROF_LABELS[level] + '</span>' +
        '<div style="flex:1;height:8px;background:rgba(0,0,0,0.04);border-radius:3px;overflow:hidden">' +
          '<div data-prof-bg="' + level + '" style="height:100%;width:' + pct + '%;background:' + rawColors[level] + ';border-radius:3px"></div>' +
        '</div>' +
        '<span style="font-size:0.62rem;color:var(--text-2);width:32px;text-align:right">' + counts[level] + '</span>' +
      '</div>';
    });
    html += '</div></div>';

    if (top.length > 0) {
      html += '<div style="font-weight:700;font-size:0.56rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-2);margin:6px 0 3px">Top Assignments</div>';
      top.forEach(function(a) {
        html += '<div style="display:flex;align-items:center;gap:6px;font-size:0.72rem;line-height:1.6">' +
          '<span data-prof="' + a.r + '" style="font-weight:600;color:' + PROF_COLORS[a.r] + ';font-size:0.64rem;width:14px;flex-shrink:0">' + (PROF_LABELS[a.r]||'?')[0] + '</span>' +
          '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(a.title) + '</span>' +
        '</div>';
      });
    }
    if (bottom.length > 0) {
      html += '<div style="font-weight:700;font-size:0.56rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-2);margin:6px 0 3px">Needs Improvement</div>';
      bottom.forEach(function(a) {
        html += '<div style="display:flex;align-items:center;gap:6px;font-size:0.72rem;line-height:1.6">' +
          '<span data-prof="' + a.r + '" style="font-weight:600;color:' + PROF_COLORS[a.r] + ';font-size:0.64rem;width:14px;flex-shrink:0">' + (PROF_LABELS[a.r]||'?')[0] + '</span>' +
          '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(a.title) + '</span>' +
        '</div>';
      });
    }
    html += '</div>';

    // RIGHT HALF
    html += '<div style="flex:1;min-width:0;display:flex;flex-direction:column">';
    html += '<div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:10px">';
    html += '<div style="flex-shrink:0">' +
      '<svg width="90" height="90" viewBox="0 0 100 100">' +
        '<circle cx="50" cy="50" r="' + gaugeR + '" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="8"/>' +
        '<circle cx="50" cy="50" r="' + gaugeR + '" fill="none" stroke="#333" stroke-width="8"' +
          ' stroke-dasharray="' + gaugeDash + ' ' + (gaugeCirc - gaugeDash) + '" stroke-dashoffset="' + (gaugeCirc * 0.25) + '"' +
          ' stroke-linecap="round"/>' +
        '<text x="50" y="46" text-anchor="middle" style="font-size:22px;font-weight:800;fill:var(--text)">' + profPct + '%</text>' +
        '<text x="50" y="60" text-anchor="middle" style="font-size:6px;fill:var(--text-3);text-transform:uppercase;letter-spacing:0.5px">at or above</text>' +
        '<text x="50" y="68" text-anchor="middle" style="font-size:6px;fill:var(--text-3);text-transform:uppercase;letter-spacing:0.5px">proficient</text>' +
      '</svg>' +
    '</div>';
    var cc = getCourseConfig(cid);
    var latePolicy = cc.lateWorkPolicy || '';
    html += '<div style="flex:1;min-width:0;padding-top:6px">' +
      '<div style="font-size:0.68rem;font-weight:700;color:var(--text-2);margin-bottom:4px">Late Work Policy</div>' +
      '<div contenteditable="true" style="font-size:0.68rem;color:' + (latePolicy ? 'var(--text-2)' : 'var(--text-3)') + ';line-height:1.45;font-style:' + (latePolicy ? 'normal' : 'italic') + ';outline:none;min-height:1.4em"' +
        ' onblur="(function(el){var v=el.textContent.trim();var c=getCourseConfig(\'' + cid + '\');c.lateWorkPolicy=v;saveCourseConfig(\'' + cid + '\',c);el.style.color=v?\'var(--text-2)\':\'var(--text-3)\';el.style.fontStyle=v?\'normal\':\'italic\';if(!v)el.textContent=\'No late work policy set\'})(this)"' +
        ' onfocus="(function(el){if(!getCourseConfig(\'' + cid + '\').lateWorkPolicy){el.textContent=\'\';el.style.color=\'var(--text-2)\';el.style.fontStyle=\'normal\'}})(this)"' +
      '>' + (latePolicy || 'No late work policy set') + '</div>' +
    '</div>';
    html += '</div>';

    if (missing.length > 0) {
      html += '<div style="padding-top:8px;border-top:1px solid var(--border)">' +
        '<div class="report-missing-title" style="font-weight:700;font-size:0.56rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--score-1);margin-bottom:4px">Missing Assignments (' + missing.length + ')</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 16px">';
      missing.forEach(function(a) {
        html += '<div style="font-size:0.68rem;color:var(--text);line-height:1.6;display:flex;align-items:baseline;gap:4px;min-width:0">' +
          '<span style="color:var(--text-3);font-size:0.56rem;flex-shrink:0;font-weight:600">' + (a.type === 'summative' ? 'S' : 'F') + '</span>' +
          '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(a.title) + '</span>' +
        '</div>';
      });
      html += '</div></div>';
    } else {
      html += '<div style="padding-top:8px;border-top:1px solid var(--border)">' +
        '<div class="report-no-missing" style="font-size:0.72rem;color:var(--score-3);font-weight:600">\u2713 No missing assignments</div>' +
      '</div>';
    }
    html += '</div>';

    html += '</div></div>';
    return html;
  }

  function renderBlockGradeTable(cid, student) {
    var assessments = getAssessments(cid).sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var scores = getScores(cid)[student.id] || [];
    if (assessments.length === 0) return '';
    var scale = getGradingScale(cid);
    var scaleLabels = scale.labels || null;
    function profLabel(level) {
      if (scaleLabels && scaleLabels[level-1]) return scaleLabels[level-1];
      return PROF_LABELS[level] || '';
    }
    var summative = assessments.filter(function(a) { return a.type === 'summative'; });
    var formative = assessments.filter(function(a) { return a.type !== 'summative'; });

    var sections = getSections(cid);

    function renderRows(list) {
      var rows = '';
      list.forEach(function(a) {
        var aScores = scores.filter(function(s) { return s.assessmentId === a.id && s.score > 0; });
        var isPoints = a.scoreMode === 'points';
        var max = a.maxPoints || 100;
        var weightLabel = (a.weight && a.weight !== 1) ? ' <span style="font-size:0.62rem;color:var(--text-3);font-weight:400">' + a.weight + '\u00d7</span>' : '';
        var dateStr = a.date ? new Date(a.date + 'T00:00:00').toLocaleDateString('en-CA', { month:'short', day:'numeric' }) : '\u2014';
        var tagSections = new Set();
        (a.tagIds || []).forEach(function(tid) {
          var sec = sections.find(function(s) { return (s.tags || []).some(function(t) { return t.id === tid; }); });
          if (sec) tagSections.add(sec.shortName || sec.name);
        });
        var tagPills = Array.from(tagSections).map(function(name) {
          return '<span style="display:inline-block;font-size:0.62rem;font-weight:500;color:var(--text-2);line-height:1.3">' + esc(name) + '</span>';
        }).join('<span style="color:var(--text-3);margin:0 2px">\u00b7</span>');
        if (aScores.length === 0) {
          rows += '<tr>' +
            '<td style="font-weight:500">' + esc(a.title) + weightLabel + '</td>' +
            '<td style="color:var(--text-3);font-size:0.76rem">' + dateStr + '</td>' +
            '<td style="font-size:0.68rem">' + tagPills + '</td>' +
            '<td style="color:var(--text-3);font-style:italic" colspan="2">Not assessed</td></tr>';
          return;
        }
        var scoreDisplay, profDisplay;
        if (isPoints) {
          var rawAvg = aScores.reduce(function(s, x) { return s + x.score; }, 0) / aScores.length;
          var pct = Math.round((rawAvg / max) * 100);
          var profLevel = pointsToProf(rawAvg, max, scale);
          var color = PROF_COLORS[profLevel] || '#bbb';
          scoreDisplay = '<td style="text-align:center;font-weight:600;font-size:1rem">' + Math.round(rawAvg) + '<span style="color:var(--text-3);font-weight:400">/' + max + '</span></td>';
          profDisplay = '<td style="text-align:center"><span data-prof="' + profLevel + '" data-prof-bg="' + profLevel + '" style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:0.74rem;font-weight:600;background:' + (PROF_TINT[profLevel]||'transparent') + ';color:' + color + '">' + profLabel(profLevel) + ' <span style="font-weight:400;opacity:0.7">' + pct + '%</span></span></td>';
        } else {
          var avg = aScores.reduce(function(s, x) { return s + x.score; }, 0) / aScores.length;
          var rr = Math.round(avg);
          var color2 = PROF_COLORS[rr] || '#bbb';
          scoreDisplay = '<td data-prof="' + rr + '" style="text-align:center;font-weight:600;font-size:1rem;color:' + color2 + '">' + rr + '<span style="color:var(--text-3);font-weight:400">/4</span></td>';
          profDisplay = '<td style="text-align:center"><span data-prof="' + rr + '" data-prof-bg="' + rr + '" style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:0.74rem;font-weight:600;background:' + (PROF_TINT[rr]||'transparent') + ';color:' + color2 + '">' + profLabel(rr) + '</span></td>';
        }
        rows += '<tr>' +
          '<td style="font-weight:500">' + esc(a.title) + weightLabel + '</td>' +
          '<td style="color:var(--text-3);font-size:0.76rem">' + dateStr + '</td>' +
          '<td style="font-size:0.68rem">' + tagPills + '</td>' +
          scoreDisplay + profDisplay + '</tr>';
      });
      return rows;
    }

    var html = '<div class="report-block-box" style="page-break-inside:avoid">' +
      '<div class="report-block-title">Assignment Grades</div>' +
      '<table class="report-tag-table report-grade-table" style="margin-top:4px">' +
        '<thead><tr>' +
          '<th style="width:36%;text-align:left">Assignment</th>' +
          '<th style="width:10%;text-align:left">Date</th>' +
          '<th style="width:18%;text-align:left">Learning Area</th>' +
          '<th style="width:12%;text-align:center">Score</th>' +
          '<th style="width:24%;text-align:center">Proficiency</th>' +
        '</tr></thead><tbody>';
    if (summative.length > 0) {
      html += '<tr class="report-grade-section"><td colspan="5" style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-2);padding:10px 0 4px;border-bottom:1.5px solid var(--border)">Summative</td></tr>';
      html += renderRows(summative);
    }
    if (formative.length > 0) {
      html += '<tr class="report-grade-section"><td colspan="5" style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-2);padding:10px 0 4px;border-bottom:1.5px solid var(--border)">Formative</td></tr>';
      html += renderRows(formative);
    }
    html += '</tbody></table></div>';
    return html;
  }

  function renderBlockCoreCompetencies(cid, student) {
    var assessments = getAssessments(cid);
    var scores = getScores(cid)[student.id] || [];
    var compData = {};
    CORE_COMPETENCIES.forEach(function(c) { compData[c.id] = { count: 0, totalScore: 0, scored: 0 }; });
    assessments.forEach(function(a) {
      var ccIds = a.coreCompetencyIds || [];
      if (ccIds.length === 0) return;
      var aScores = scores.filter(function(s) { return s.assessmentId === a.id && s.score > 0; });
      var avg = aScores.length > 0 ? aScores.reduce(function(sum, s) { return sum + s.score; }, 0) / aScores.length : 0;
      ccIds.forEach(function(ccId) {
        if (compData[ccId]) {
          compData[ccId].count++;
          if (avg > 0) { compData[ccId].totalScore += avg; compData[ccId].scored++; }
        }
      });
    });
    var hasAny = Object.values(compData).some(function(d) { return d.count > 0; });
    if (!hasAny) return '';
    var groups = {};
    CORE_COMPETENCIES.forEach(function(c) {
      if (!groups[c.group]) groups[c.group] = [];
      groups[c.group].push(c);
    });
    var html = '<div class="report-block-box" style="page-break-inside:avoid">' +
      '<div class="report-block-title">Core Competencies</div>' +
      '<div style="font-size:0.7rem;color:var(--text-2);margin:-2px 0 8px;line-height:1.35">Core competencies are the skills, habits, and dispositions students develop across all areas of learning. Progress is based on observations from classroom assessments.</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:16px;padding:2px 0">';
    Object.entries(groups).forEach(function(entry) {
      var groupName = entry[0];
      var comps = entry[1];
      html += '<div style="flex:1;min-width:180px">' +
        '<div style="font-size:0.62rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-3);font-weight:600;margin-bottom:6px">' + esc(groupName) + '</div>';
      comps.forEach(function(c) {
        var d = compData[c.id];
        var avg = d.scored > 0 ? d.totalScore / d.scored : 0;
        var rr = Math.round(avg);
        var pct = avg > 0 ? (avg / 4 * 100) : 0;
        var color = avg > 0 ? (PROF_COLORS[rr] || '#bbb') : '#ddd';
        var pl = d.count === 0 ? 'Not yet assessed' : (avg > 0 ? PROF_LABELS[rr] : 'Not yet assessed');
        var labelColor = avg > 0 ? color : 'var(--text-3)';
        html += '<div style="margin-bottom:6px">' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:2px">' +
            '<span style="font-size:0.75rem;font-weight:500;color:var(--text)">' + esc(c.label) + '</span>' +
            '<span data-prof="' + rr + '" style="font-size:0.65rem;font-weight:600;color:' + labelColor + ';white-space:nowrap">' + pl + '</span>' +
          '</div>' +
          '<div style="height:8px;background:rgba(0,0,0,0.04);border-radius:4px;overflow:hidden">' +
            '<div data-prof-bg="' + rr + '" style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:4px"></div>' +
          '</div>' +
          '<div style="font-size:0.58rem;color:var(--text-3);margin-top:1px">Based on ' + d.count + ' assessment' + (d.count !== 1 ? 's' : '') + '</div>' +
        '</div>';
      });
      html += '</div>';
    });
    html += '</div></div>';
    return html;
  }

  /* ── Block dispatcher ── */
  function renderReportBlock(blockId, cid, student) {
    switch (blockId) {
      case 'header':            return renderBlockHeader(cid, student);
      case 'academic-summary':  return renderBlockAcademicSummary(cid, student);
      case 'section-chart':     return renderBlockSectionChart(cid, student);
      case 'score-distribution':return renderBlockScoreDistribution(cid, student);
      case 'grade-table':       return renderBlockGradeTable(cid, student);
      case 'section-outcomes':  return renderBlockSectionOutcomes(cid, student);
      case 'core-competencies': return renderBlockCoreCompetencies(cid, student);
      case 'learner-dimensions': return renderBlockLearnerDimensions(cid, student);
      case 'teacher-narrative':  return renderBlockTeacherNarrative(cid, student);
      case 'observations':      return renderBlockObservations(cid, student);
      case 'next-steps':        return renderBlockNextSteps(cid, student);
      case 'legend':            return renderBlockLegend();
      case 'parent-response':   return renderBlockParentResponse(cid, student);
      case 'student-reflection-learning': return renderBlockStudentReflectionLearning(cid, student);
      case 'student-reflection-habits':   return renderBlockStudentReflectionHabits(cid, student);
      default: return '';
    }
  }

  /* ── Public API ── */
  return {
    renderBlockHeader: renderBlockHeader,
    renderBlockAcademicSummary: renderBlockAcademicSummary,
    renderBlockLearnerDimensions: renderBlockLearnerDimensions,
    renderBlockTeacherNarrative: renderBlockTeacherNarrative,
    renderBlockObservations: renderBlockObservations,
    renderBlockSectionOutcomes: renderBlockSectionOutcomes,
    renderBlockNextSteps: renderBlockNextSteps,
    renderBlockLegend: renderBlockLegend,
    renderBlockParentResponse: renderBlockParentResponse,
    renderBlockStudentReflectionLearning: renderBlockStudentReflectionLearning,
    renderBlockStudentReflectionHabits: renderBlockStudentReflectionHabits,
    renderBlockSectionChart: renderBlockSectionChart,
    renderBlockScoreDistribution: renderBlockScoreDistribution,
    renderBlockGradeTable: renderBlockGradeTable,
    renderBlockCoreCompetencies: renderBlockCoreCompetencies,
    renderReportBlock: renderReportBlock,
    sanitizeNarrativeHtml: sanitizeNarrativeHtml,
    getPronouns: getPronouns,
    OBS_DESCRIPTORS: OBS_DESCRIPTORS
  };
})();
