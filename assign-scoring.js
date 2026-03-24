/* ── assign-scoring.js — Scoring grid and rubric grading submodule ── */
window.AssignScoring = (function() {
  'use strict';

  /* ── Score persistence helper ─────────────────────────────── */
  function setScore(cid, sid, aid, tagId, value) {
    var sc = getScores(cid); if (!sc[sid]) sc[sid] = [];
    var assess = getAssessments(cid).find(function(a) { return a.id === aid; });
    var idx = sc[sid].findIndex(function(s) { return s.assessmentId === aid && s.tagId === tagId; });
    if (idx >= 0) { sc[sid][idx].score = value; }
    else { sc[sid].push({ id: uid(), assessmentId: aid, tagId: tagId, score: value, date: assess?assess.date:'', type: assess?assess.type:'summative', note:'', created: new Date().toISOString() }); }
    saveScores(cid, sc);
  }

  /* ── Status toggles HTML ──────────────────────────────────── */
  function renderStatusToggles(aid, sid, currentStatus, cid) {
    var commentCount = getAssignmentObs(cid, sid, aid).length;
    return '<div class="student-status-toggles">' +
      '<button class="student-status-btn' + (currentStatus==='excused'?' active-excused':'') + '" tabindex="-1" data-action="toggleStudentStatus" data-aid="' + aid + '" data-sid="' + sid + '" data-status="excused" data-stop-prop="true" title="Excused">EXC</button>' +
      '<button class="student-status-btn' + (currentStatus==='notSubmitted'?' active-ns':'') + '" tabindex="-1" data-action="toggleStudentStatus" data-aid="' + aid + '" data-sid="' + sid + '" data-status="notSubmitted" data-stop-prop="true" title="Not Submitted">NS</button>' +
      '<button class="comment-btn" data-action="openCommentPopover" data-cid="' + cid + '" data-sid="' + sid + '" data-aid="' + aid + '" data-stop-prop="true" title="Comments">Comment' + (commentCount > 0 ? ' <span class="comment-count">' + commentCount + '</span>' : '') + '</button>' +
    '</div>';
  }

  /* ── Points Grid ──────────────────────────────────────────── */
  function renderPointsGrid(cid, a, students, scores) {
    var max = a.maxPoints || 100;
    var statuses = getAssignmentStatuses(cid);
    var html = '<div class="score-grid pts-grid">' +
      '<div class="score-grid-header">' +
        '<div class="score-grid-header-name">Student</div>' +
        '<div class="score-col-header" style="text-align:center"><span class="score-col-header-id">Score</span><span class="score-col-header-name">out of ' + max + '</span></div>' +
        '<div class="score-col-header" style="text-align:center"><span class="score-col-header-id">%</span></div>' +
        '<div class="score-row-action"></div>' +
      '</div>';
    students.forEach(function(st) {
      var raw = getPointsScore(cid, st.id, a.id);
      var pct = raw > 0 ? Math.round(raw / max * 100) : '';
      var stStatus = statuses[st.id + ':' + a.id] || null;
      html += '<div class="score-row' + (stStatus ? ' has-status' : '') + '" data-status-student="' + st.id + '" data-status-assess="' + a.id + '">' +
        '<span class="score-name">' + esc(displayName(st)) + renderStatusToggles(a.id, st.id, stStatus, cid) + '</span>' +
        '<div class="pts-input-cell">' +
          '<input type="number" class="gb-pts-input" min="0" max="' + max + '" inputmode="numeric"' +
            ' value="' + (raw > 0 ? raw : '') + '" data-sid="' + st.id + '" data-aid="' + a.id + '" data-max="' + max + '"' +
            (stStatus ? ' disabled' : '') + '>' +
          '<span class="gb-pts-max">/' + max + '</span>' +
        '</div>' +
        '<div class="pts-pct-cell">' +
          '<span class="gb-pts-live-pct">' + (pct ? pct + '%' : '') + '</span>' +
        '</div>' +
        '<div class="score-row-action"></div>' +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  /* ── Points input helpers ─────────────────────────────────── */
  function livePointsUpdate(inp) {
    var v = parseInt(inp.value); var max = parseInt(inp.dataset.max) || 100;
    var pctSpan = inp.closest('.score-row').querySelector('.gb-pts-live-pct');
    if (pctSpan) pctSpan.textContent = (!isNaN(v) && v >= 0) ? Math.round(Math.min(v, max) / max * 100) + '%' : '';
  }

  function commitPointsScore(inp, activeCourse) {
    var cid = activeCourse; var sid = inp.dataset.sid; var aid = inp.dataset.aid;
    var max = parseInt(inp.dataset.max) || 100;
    var val = parseInt(inp.value);
    var raw = isNaN(val) ? 0 : Math.max(0, Math.min(max, val));
    inp.value = raw > 0 ? raw : '';
    setScore(cid, sid, aid, aid, raw);
    setPointsScore(cid, sid, aid, raw);
    var pctSpan = inp.closest('.score-row').querySelector('.gb-pts-live-pct');
    if (pctSpan) pctSpan.textContent = raw > 0 ? Math.round(raw / max * 100) + '%' : '';
  }

  function handlePointsKey(e, inp, activeCourse) {
    if (e.key === 'Enter') {
      e.preventDefault(); commitPointsScore(inp, activeCourse);
      var row = inp.closest('.score-row'); var next = row.nextElementSibling;
      if (next) { var ni = next.querySelector('.gb-pts-input'); if (ni) { ni.focus(); ni.select(); } }
    } else if (e.key === 'Escape') {
      var raw = getPointsScore(activeCourse, inp.dataset.sid, inp.dataset.aid);
      inp.value = raw > 0 ? raw : ''; inp.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault(); var next = inp.closest('.score-row').nextElementSibling;
      if (next) { var ni = next.querySelector('.gb-pts-input'); if (ni) { ni.focus(); ni.select(); } }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); var prev = inp.closest('.score-row').previousElementSibling;
      if (prev) { var pi = prev.querySelector('.gb-pts-input'); if (pi) { pi.focus(); pi.select(); } }
    }
  }

  /* ── Student status toggle ────────────────────────────────── */
  function toggleStudentStatus(aid, sid, status, activeCourse, statusDebounce, callbacks) {
    var debounceKey = sid + ':' + aid + ':' + status;
    if (statusDebounce[debounceKey]) return;
    statusDebounce[debounceKey] = true;
    setTimeout(function() { delete statusDebounce[debounceKey]; }, 300);
    var cid = activeCourse;
    var current = getAssignmentStatus(cid, sid, aid);
    var newStatus = current === status ? null : status;
    setAssignmentStatus(cid, sid, aid, newStatus);
    if (newStatus === 'notSubmitted') {
      var assess = getAssessments(cid).find(function(a) { return a.id === aid; });
      if (assess) {
        var sc = getScores(cid); if (!sc[sid]) sc[sid] = [];
        (assess.tagIds || []).forEach(function(tagId) {
          var idx = sc[sid].findIndex(function(s) { return s.assessmentId === aid && s.tagId === tagId; });
          if (idx >= 0) sc[sid][idx].score = 0;
          else sc[sid].push({ id: uid(), assessmentId: aid, tagId: tagId, score: 0, date: assess.date || '', type: assess.type || 'summative', note: '', created: new Date().toISOString() });
        });
        saveScores(cid, sc);
      }
    }
    var row = document.querySelector('.score-row[data-status-student="' + sid + '"][data-status-assess="' + aid + '"]') ||
              document.querySelector('.rsg-student[data-status-student="' + sid + '"][data-status-assess="' + aid + '"]');
    if (row) {
      row.querySelectorAll('.student-status-btn').forEach(function(btn) { btn.classList.remove('active-excused', 'active-ns'); });
      if (newStatus === 'excused') row.querySelector('.student-status-btn:first-child').classList.add('active-excused');
      else if (newStatus === 'notSubmitted') row.querySelector('.student-status-btn:nth-child(2)').classList.add('active-ns');
      if (newStatus) row.classList.add('has-status'); else row.classList.remove('has-status');
      var ptsInput = row.querySelector('.gb-pts-input');
      if (ptsInput) ptsInput.disabled = !!newStatus;
      if (newStatus === 'notSubmitted') {
        row.querySelectorAll('.score-opt, .rsg-level').forEach(function(el) { el.classList.remove('active', 'mixed'); });
        if (ptsInput) { ptsInput.value = ''; var ps = row.querySelector('.gb-pts-live-pct'); if (ps) ps.textContent = ''; }
      }
    }
    if (callbacks && callbacks.refreshSidebar) callbacks.refreshSidebar();
  }

  /* ── Score group UI update ────────────────────────────────── */
  function updateGroupUI(group, value) {
    group.querySelectorAll('.score-opt').forEach(function(o) { o.classList.remove('active'); });
    if (value > 0) { var opt = group.querySelector('.s' + value); if (opt) opt.classList.add('active'); }
  }

  /* ── Tag-level score selection ────────────────────────────── */
  function selectTagLevel(el, value, aid, sid, tagId, activeCourse, callbacks) {
    var wasActive = el.classList.contains('active');
    var next = wasActive ? 0 : value;
    setScore(activeCourse, sid, aid, tagId, next);
    el.parentElement.querySelectorAll('.rsg-level').forEach(function(o) { o.classList.remove('active'); });
    if (!wasActive) el.classList.add('active');
    if (callbacks && callbacks.refreshSidebar) callbacks.refreshSidebar();
  }

  function selectScore(el, value, activeCourse, callbacks) {
    var group = el.parentElement;
    var cid = activeCourse; var sid = group.dataset.student; var aid = group.dataset.assess; var tagId = group.dataset.tag;
    var sc = getScores(cid); if (!sc[sid]) sc[sid] = [];
    var assess = getAssessments(cid).find(function(a) { return a.id === aid; });
    var idx = sc[sid].findIndex(function(s) { return s.assessmentId === aid && s.tagId === tagId; });
    var wasActive = el.classList.contains('active');
    var next = wasActive ? 0 : value;
    if (idx >= 0) sc[sid][idx].score = next;
    else sc[sid].push({ id: uid(), assessmentId: aid, tagId: tagId, score: next, date: assess?assess.date:'', type: assess?assess.type:'summative', note:'', created: new Date().toISOString() });
    saveScores(cid, sc);
    group.querySelectorAll('.score-opt').forEach(function(o) { o.classList.remove('active'); });
    if (!wasActive) el.classList.add('active');
    if (callbacks && callbacks.refreshSidebar) callbacks.refreshSidebar();
  }

  /* ── Bulk fill menus ──────────────────────────────────────── */
  function closeMenus() { document.querySelectorAll('.col-fill-menu').forEach(function(m) { m.classList.remove('open'); }); }

  function positionMenu(trigger, menu) {
    var rect = trigger.getBoundingClientRect(); var menuH = 180; var spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < menuH) { menu.style.bottom = (window.innerHeight - rect.top + 4) + 'px'; menu.style.top = 'auto'; }
    else { menu.style.top = (rect.bottom + 4) + 'px'; menu.style.bottom = 'auto'; }
    var menuW = 150; var left = rect.left + rect.width / 2 - menuW / 2;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    if (left < 8) left = 8;
    menu.style.left = left + 'px';
  }

  function toggleScoreMenu(trigger) {
    var menu = trigger.querySelector('.col-fill-menu'); var wasOpen = menu.classList.contains('open');
    closeMenus(); if (!wasOpen) { positionMenu(trigger, menu); menu.classList.add('open'); }
  }

  function fillScores(aid, tagId, value, scope, activeCourse, callbacks) {
    var cid = activeCourse; var prevScores = structuredClone(getScores(cid));
    var students = getStudents(cid); var assess = getAssessments(cid).find(function(a) { return a.id === aid; });
    var statuses = getAssignmentStatuses(cid); var selector, toastMsg;
    if (scope === 'col') {
      students.forEach(function(st) { if (statuses[st.id + ':' + aid]) return; setScore(cid, st.id, aid, tagId, value); });
      selector = '.score-group[data-assess="' + aid + '"][data-tag="' + tagId + '"]'; toastMsg = 'Column filled';
    } else if (scope === 'row') {
      if (!assess) return; var sid = tagId;
      if (!statuses[sid + ':' + aid]) (assess.tagIds || []).forEach(function(tid) { setScore(cid, sid, aid, tid, value); });
      selector = '.score-group[data-assess="' + aid + '"][data-student="' + sid + '"]'; toastMsg = 'Row filled';
    } else {
      if (!assess) return;
      students.forEach(function(st) { if (statuses[st.id + ':' + aid]) return; (assess.tagIds || []).forEach(function(tid) { setScore(cid, st.id, aid, tid, value); }); });
      selector = '.score-group[data-assess="' + aid + '"]'; toastMsg = 'All scores filled';
    }
    document.querySelectorAll(selector).forEach(function(g) { updateGroupUI(g, value); });
    if (callbacks && callbacks.refreshSidebar) callbacks.refreshSidebar();
    showUndoToast(toastMsg, function() { saveScores(cid, prevScores); if (callbacks && callbacks.render) callbacks.render(); if (callbacks && callbacks.refreshSidebar) callbacks.refreshSidebar(); });
  }

  /* ── Rubric grading helpers ───────────────────────────────── */
  function getRubricCriterion(aid, critId, activeCourse) {
    var assess = getAssessments(activeCourse).find(function(a) { return a.id === aid; });
    if (!assess || !assess.rubricId) return null;
    var rubric = getRubricById(activeCourse, assess.rubricId);
    if (!rubric) return null;
    return rubric.criteria.find(function(c) { return c.id === critId; });
  }

  function selectRubricScore(el, value, aid, sid, critId, activeCourse, callbacks) {
    var crit = getRubricCriterion(aid, critId, activeCourse); if (!crit) return;
    var wasActive = el.classList.contains('active'); var next = wasActive ? 0 : value;
    (crit.tagIds || []).forEach(function(tagId) { setScore(activeCourse, sid, aid, tagId, next); });
    el.parentElement.querySelectorAll('.rsg-level').forEach(function(o) { o.classList.remove('active','mixed'); });
    if (!wasActive) el.classList.add('active');
    if (callbacks && callbacks.refreshSidebar) callbacks.refreshSidebar();
  }

  function updateRubricRowUI(row, value) {
    row.querySelectorAll('.rsg-level').forEach(function(l) { l.classList.remove('active','mixed'); });
    if (value > 0) { var lvl = row.querySelector('.l' + value); if (lvl) lvl.classList.add('active'); }
  }

  function fillRubricScores(aid, critId, value, scope, activeCourse, callbacks) {
    var cid = activeCourse; var prevScores = structuredClone(getScores(cid));
    var students = getStudents(cid); var assess = getAssessments(cid).find(function(a) { return a.id === aid; });
    var statuses = getAssignmentStatuses(cid); var selector, toastMsg;
    if (scope === 'col') {
      var crit = getRubricCriterion(aid, critId, cid); if (!crit) return;
      students.forEach(function(st) { if (statuses[st.id + ':' + aid]) return; (crit.tagIds || []).forEach(function(tagId) { setScore(cid, st.id, aid, tagId, value); }); });
      selector = '.rsg-criterion-row[data-assess="' + aid + '"][data-criterion="' + critId + '"]'; toastMsg = 'Criterion filled';
    } else if (scope === 'row') {
      if (!assess || !assess.rubricId) return;
      var rubric = getRubricById(cid, assess.rubricId); if (!rubric) return;
      var sid = critId;
      if (!statuses[sid + ':' + aid]) rubric.criteria.forEach(function(crit) { (crit.tagIds || []).forEach(function(tagId) { setScore(cid, sid, aid, tagId, value); }); });
      selector = '.rsg-criterion-row[data-assess="' + aid + '"][data-student="' + sid + '"]'; toastMsg = 'Row filled';
    } else {
      if (!assess || !assess.rubricId) return;
      var rubric = getRubricById(cid, assess.rubricId); if (!rubric) return;
      students.forEach(function(st) { if (statuses[st.id + ':' + aid]) return; rubric.criteria.forEach(function(crit) { (crit.tagIds || []).forEach(function(tagId) { setScore(cid, st.id, aid, tagId, value); }); }); });
      selector = '.rsg-criterion-row[data-assess="' + aid + '"]'; toastMsg = 'All rubric scores filled';
    }
    document.querySelectorAll(selector).forEach(function(row) { updateRubricRowUI(row, value); });
    if (callbacks && callbacks.refreshSidebar) callbacks.refreshSidebar();
    showUndoToast(toastMsg, function() { saveScores(cid, prevScores); if (callbacks && callbacks.render) callbacks.render(); if (callbacks && callbacks.refreshSidebar) callbacks.refreshSidebar(); });
  }

  function confirmFillAll(aid, value, label, activeCourse, callbacks) {
    showConfirm('Fill All Scores', 'Set all students to "' + label + '"?', 'Fill All', 'primary', function() { fillScores(aid, null, value, 'all', activeCourse, callbacks); });
  }
  function confirmFillRubricAll(aid, value, label, activeCourse, callbacks) {
    showConfirm('Fill All Scores', 'Set all students to "' + label + '" for every criterion?', 'Fill All', 'primary', function() { fillRubricScores(aid, null, value, 'all', activeCourse, callbacks); });
  }

  /* ── Tag Grid (proficiency-based) ─────────────────────────── */
  function renderTagGrid(cid, a, tagObjs, students, scores) {
    var html = '<div class="rsg-grid">';
    html += '<div class="rsg-header"><div class="rsg-header-spacer">Student</div><div class="rsg-header-inner"><div class="rsg-header-crit-spacer"></div><div class="rsg-header-levels">' +
      '<div class="rsg-header-level hl4" data-action="confirmFillAll" data-aid="' + a.id + '" data-score="4" data-label="Extending" title="Fill all Extending">Extending</div>' +
      '<div class="rsg-header-level hl3" data-action="confirmFillAll" data-aid="' + a.id + '" data-score="3" data-label="Proficient" title="Fill all Proficient">Proficient</div>' +
      '<div class="rsg-header-level hl2" data-action="confirmFillAll" data-aid="' + a.id + '" data-score="2" data-label="Developing" title="Fill all Developing">Developing</div>' +
      '<div class="rsg-header-level hl1" data-action="confirmFillAll" data-aid="' + a.id + '" data-score="1" data-label="Emerging" title="Fill all Emerging">Emerging</div>' +
      '</div></div><div class="rsg-header-action"></div></div>';
    var statuses = getAssignmentStatuses(cid);
    students.forEach(function(st) {
      var studentScores = scores[st.id] || [];
      var stStatus = statuses[st.id + ':' + a.id] || null;
      html += '<div class="rsg-student' + (stStatus ? ' has-status' : '') + '" data-status-student="' + st.id + '" data-status-assess="' + a.id + '">' +
        '<div class="rsg-student-name">' + esc(displayName(st)) + renderStatusToggles(a.id, st.id, stStatus, cid) + '</div><div class="rsg-criteria">';
      tagObjs.forEach(function(tag) {
        var entry = studentScores.find(function(s) { return s.assessmentId === a.id && s.tagId === tag.id; });
        var score = entry ? entry.score : 0;
        html += '<div class="rsg-criterion-row is-tag" data-student="' + st.id + '" data-assess="' + a.id + '" data-tag="' + tag.id + '">' +
          '<div class="rsg-criterion-label" title="' + esc(tag.text || tag.label) + '"><svg class="rsg-tag-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 9.5V2.5a1 1 0 0 1 1-1h7l5 5v3"/><path d="M14.5 9.5l-5 5-4-4 5-5"/><circle cx="5" cy="5" r="1" fill="currentColor" stroke="none"/></svg>' + esc(tag.label) + '</div>' +
          '<div class="rsg-levels">' +
            '<div class="rsg-level l4' + (score===4?' active':'') + '" data-action="selectTagLevel" data-level="4" data-aid="' + a.id + '" data-sid="' + st.id + '" data-tagid="' + tag.id + '" role="button" tabindex="0">Extending</div>' +
            '<div class="rsg-level l3' + (score===3?' active':'') + '" data-action="selectTagLevel" data-level="3" data-aid="' + a.id + '" data-sid="' + st.id + '" data-tagid="' + tag.id + '" role="button" tabindex="0">Proficient</div>' +
            '<div class="rsg-level l2' + (score===2?' active':'') + '" data-action="selectTagLevel" data-level="2" data-aid="' + a.id + '" data-sid="' + st.id + '" data-tagid="' + tag.id + '" role="button" tabindex="0">Developing</div>' +
            '<div class="rsg-level l1' + (score===1?' active':'') + '" data-action="selectTagLevel" data-level="1" data-aid="' + a.id + '" data-sid="' + st.id + '" data-tagid="' + tag.id + '" role="button" tabindex="0">Emerging</div>' +
          '</div></div>';
      });
      html += '</div><div class="score-row-action"><div class="row-fill-btn" data-action="toggleScoreMenu" title="Fill row">\u25BC<div class="col-fill-menu" data-stop-prop="true">' +
        '<div class="col-fill-option" data-action="fillScoresAndClose" data-aid="' + a.id + '" data-sid="' + st.id + '" data-score="4" data-scope="row"><div class="col-fill-dot" style="background:var(--score-4)">4</div> Extending</div>' +
        '<div class="col-fill-option" data-action="fillScoresAndClose" data-aid="' + a.id + '" data-sid="' + st.id + '" data-score="3" data-scope="row"><div class="col-fill-dot" style="background:var(--score-3)">3</div> Proficient</div>' +
        '<div class="col-fill-option" data-action="fillScoresAndClose" data-aid="' + a.id + '" data-sid="' + st.id + '" data-score="2" data-scope="row"><div class="col-fill-dot" style="background:var(--score-2)">2</div> Developing</div>' +
        '<div class="col-fill-option" data-action="fillScoresAndClose" data-aid="' + a.id + '" data-sid="' + st.id + '" data-score="1" data-scope="row"><div class="col-fill-dot" style="background:var(--score-1)">1</div> Emerging</div>' +
        '<div class="col-fill-option" data-action="fillScoresAndClose" data-aid="' + a.id + '" data-sid="' + st.id + '" data-score="0" data-scope="row"><div class="col-fill-dot" style="background:var(--surface-2);color:var(--text-3)">0</div> Clear</div>' +
      '</div></div></div></div>';
    });
    html += '</div>';
    return html;
  }

  /* ── Rubric Grading View ──────────────────────────────────── */
  function renderRubricGradingView(cid, a, students, scores) {
    var rubric = getRubricById(cid, a.rubricId); if (!rubric) return '';
    var criteria = rubric.criteria || [];
    var rubricTagIds = new Set(); criteria.forEach(function(c) { (c.tagIds||[]).forEach(function(t) { rubricTagIds.add(t); }); });
    var extraTagIds = (a.tagIds || []).filter(function(tid) { return !rubricTagIds.has(tid); });
    var extraTagObjs = extraTagIds.map(function(tid) { return getTagById(cid, tid); }).filter(Boolean);

    var html = '<div class="rsg-grid">';
    html += '<div class="rsg-header"><div class="rsg-header-spacer">Student</div><div class="rsg-header-inner"><div class="rsg-header-crit-spacer"></div><div class="rsg-header-levels">' +
      '<div class="rsg-header-level hl4" data-action="confirmFillRubricAll" data-aid="' + a.id + '" data-score="4" data-label="Extending" title="Fill all Extending">Extending</div>' +
      '<div class="rsg-header-level hl3" data-action="confirmFillRubricAll" data-aid="' + a.id + '" data-score="3" data-label="Proficient" title="Fill all Proficient">Proficient</div>' +
      '<div class="rsg-header-level hl2" data-action="confirmFillRubricAll" data-aid="' + a.id + '" data-score="2" data-label="Developing" title="Fill all Developing">Developing</div>' +
      '<div class="rsg-header-level hl1" data-action="confirmFillRubricAll" data-aid="' + a.id + '" data-score="1" data-label="Emerging" title="Fill all Emerging">Emerging</div>' +
    '</div></div><div class="rsg-header-action"></div></div>';

    var statuses = getAssignmentStatuses(cid);
    students.forEach(function(st) {
      var studentScores = scores[st.id] || [];
      var stStatus = statuses[st.id + ':' + a.id] || null;
      html += '<div class="rsg-student' + (stStatus ? ' has-status' : '') + '" data-status-student="' + st.id + '" data-status-assess="' + a.id + '">' +
        '<div class="rsg-student-name">' + esc(displayName(st)) + renderStatusToggles(a.id, st.id, stStatus, cid) + '</div><div class="rsg-criteria">';
      criteria.forEach(function(crit) {
        var tagScores = (crit.tagIds||[]).map(function(tid) { var entry = studentScores.find(function(s) { return s.assessmentId === a.id && s.tagId === tid; }); return entry ? entry.score : 0; });
        var nonZero = tagScores.filter(function(s) { return s > 0; });
        var allSame = nonZero.length > 0 && nonZero.every(function(s) { return s === nonZero[0]; });
        var displayScore = nonZero.length === 0 ? 0 : (allSame ? nonZero[0] : Math.min.apply(null, nonZero));
        var isMixed = nonZero.length > 0 && !allSame;
        html += '<div class="rsg-criterion-row" data-student="' + st.id + '" data-assess="' + a.id + '" data-criterion="' + crit.id + '">' +
          '<div class="rsg-criterion-label" title="' + esc(crit.name) + '">' + esc(crit.name) + '</div><div class="rsg-levels">' +
            '<div class="rsg-level l4' + (displayScore===4?(isMixed?' active mixed':' active'):'') + '" data-action="selectRubricScore" data-level="4" data-aid="' + a.id + '" data-sid="' + st.id + '" data-critid="' + crit.id + '" role="button" tabindex="0">Extending</div>' +
            '<div class="rsg-level l3' + (displayScore===3?(isMixed?' active mixed':' active'):'') + '" data-action="selectRubricScore" data-level="3" data-aid="' + a.id + '" data-sid="' + st.id + '" data-critid="' + crit.id + '" role="button" tabindex="0">Proficient</div>' +
            '<div class="rsg-level l2' + (displayScore===2?(isMixed?' active mixed':' active'):'') + '" data-action="selectRubricScore" data-level="2" data-aid="' + a.id + '" data-sid="' + st.id + '" data-critid="' + crit.id + '" role="button" tabindex="0">Developing</div>' +
            '<div class="rsg-level l1' + (displayScore===1?(isMixed?' active mixed':' active'):'') + '" data-action="selectRubricScore" data-level="1" data-aid="' + a.id + '" data-sid="' + st.id + '" data-critid="' + crit.id + '" role="button" tabindex="0">Emerging</div>' +
          '</div></div>';
      });
      html += '</div><div class="score-row-action"><div class="row-fill-btn" data-action="toggleScoreMenu" title="Fill row">\u25BC<div class="col-fill-menu" data-stop-prop="true">' +
        '<div class="col-fill-option" data-action="fillRubricScoresAndClose" data-aid="' + a.id + '" data-sid="' + st.id + '" data-score="4" data-scope="row"><div class="col-fill-dot" style="background:var(--score-4)">4</div> Extending</div>' +
        '<div class="col-fill-option" data-action="fillRubricScoresAndClose" data-aid="' + a.id + '" data-sid="' + st.id + '" data-score="3" data-scope="row"><div class="col-fill-dot" style="background:var(--score-3)">3</div> Proficient</div>' +
        '<div class="col-fill-option" data-action="fillRubricScoresAndClose" data-aid="' + a.id + '" data-sid="' + st.id + '" data-score="2" data-scope="row"><div class="col-fill-dot" style="background:var(--score-2)">2</div> Developing</div>' +
        '<div class="col-fill-option" data-action="fillRubricScoresAndClose" data-aid="' + a.id + '" data-sid="' + st.id + '" data-score="1" data-scope="row"><div class="col-fill-dot" style="background:var(--score-1)">1</div> Emerging</div>' +
        '<div class="col-fill-option" data-action="fillRubricScoresAndClose" data-aid="' + a.id + '" data-sid="' + st.id + '" data-score="0" data-scope="row"><div class="col-fill-dot" style="background:var(--surface-2);color:var(--text-3)">0</div> Clear</div>' +
      '</div></div></div></div>';
    });
    html += '</div>';

    if (extraTagObjs.length > 0) {
      html += '<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">' +
        '<div style="font-family:\'SF Mono\', ui-monospace, \'Menlo\', monospace;font-size:0.6rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-3);font-weight:600;margin-bottom:6px">Additional Tags (not in rubric)</div>';
      html += renderTagGrid(cid, a, extraTagObjs, students, scores);
      html += '</div>';
    }
    return html;
  }

  /* ── Public API ───────────────────────────────────────────── */
  return {
    renderPointsGrid: renderPointsGrid,
    renderTagGrid: renderTagGrid,
    renderRubricGradingView: renderRubricGradingView,
    livePointsUpdate: livePointsUpdate,
    commitPointsScore: commitPointsScore,
    handlePointsKey: handlePointsKey,
    setScore: setScore,
    selectScore: selectScore,
    selectTagLevel: selectTagLevel,
    selectRubricScore: selectRubricScore,
    renderStatusToggles: renderStatusToggles,
    toggleStudentStatus: toggleStudentStatus,
    updateGroupUI: updateGroupUI,
    updateRubricRowUI: updateRubricRowUI,
    closeMenus: closeMenus,
    toggleScoreMenu: toggleScoreMenu,
    fillScores: fillScores,
    fillRubricScores: fillRubricScores,
    confirmFillAll: confirmFillAll,
    confirmFillRubricAll: confirmFillRubricAll,
    getRubricCriterion: getRubricCriterion
  };
})();
