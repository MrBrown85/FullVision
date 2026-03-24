/* ── assign-rubric-editor.js — Rubric editor submodule ────────── */
window.AssignRubricEditor = (function() {
  'use strict';

  /* ── Editor state ─────────────────────────────────────────── */
  var _editingRubric = null;
  var _rubricDirty = false;
  var _critTagSection = {};
  var _expandedCriterion = 0;

  /* ── State accessors ──────────────────────────────────────── */
  function getEditingRubric() { return _editingRubric; }
  function isRubricDirty() { return _rubricDirty; }

  function resetEditorState() {
    _editingRubric = null;
    _rubricDirty = false;
    _critTagSection = {};
    _expandedCriterion = 0;
  }

  /* ── Descriptor bar ───────────────────────────────────────── */
  function _ensureDescriptorBar() {
    var bar = document.getElementById('rsg-descriptor-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'rsg-descriptor-bar'; bar.id = 'rsg-descriptor-bar';
      bar.innerHTML = '<div class="rsg-descriptor-left"><span class="rsg-descriptor-label"></span><span class="rsg-descriptor-tags"></span></div><span class="rsg-descriptor-text"></span>';
      document.body.appendChild(bar);
      _resetDescriptorBarContent(bar);
    }
    return bar;
  }

  function _resetDescriptorBarContent(bar) {
    bar.querySelector('.rsg-descriptor-label').innerHTML = '';
    bar.querySelector('.rsg-descriptor-tags').innerHTML = '';
    bar.querySelector('.rsg-descriptor-text').innerHTML = '<span class="rsg-descriptor-idle">Hover a rubric level to see its descriptor</span>';
  }

  function showDescriptorBar() { var bar = _ensureDescriptorBar(); bar.style.display = 'flex'; }
  function hideDescriptorBar() { var bar = document.getElementById('rsg-descriptor-bar'); if (bar) bar.style.display = 'none'; }
  function resetDescriptorBar() { var bar = document.getElementById('rsg-descriptor-bar'); if (bar) _resetDescriptorBarContent(bar); }

  function showCritTooltip(event, aid, critId, level, activeCourse) {
    var assess = getAssessments(activeCourse).find(function(a) { return a.id === aid; });
    if (!assess || !assess.rubricId) return;
    var rubric = getRubricById(activeCourse, assess.rubricId);
    if (!rubric) return;
    var crit = rubric.criteria.find(function(c) { return c.id === critId; });
    if (!crit || !crit.levels || !crit.levels[level]) return;
    var levelNames = { 4:'Extending', 3:'Proficient', 2:'Developing', 1:'Emerging' };
    var levelColors = { 4:'var(--score-4)', 3:'var(--score-3)', 2:'var(--score-2)', 1:'var(--score-1)' };
    var bar = _ensureDescriptorBar();
    bar.querySelector('.rsg-descriptor-label').innerHTML = esc(crit.name) + ' <span style="color:' + (levelColors[level]||'#fff') + '">\u2014 ' + (levelNames[level] || level) + '</span>';
    var tagsHtml = (crit.tagIds || []).map(function(tid) {
      var tag = getTagById(activeCourse, tid); var sec = getSectionForTag(activeCourse, tid); var color = sec ? sec.color : '#888';
      return '<span class="rsg-descriptor-tag" style="border-color:' + color + ';color:' + color + '">' + esc(tid) + (tag ? ' \u00B7 ' + esc(tag.label) : '') + '</span>';
    }).join('');
    bar.querySelector('.rsg-descriptor-tags').innerHTML = tagsHtml;
    bar.querySelector('.rsg-descriptor-text').textContent = crit.levels[level];
  }

  /* ── Rubric Builder UI ────────────────────────────────────── */
  function newRubricUI() {
    _editingRubric = { id: uid(), name: 'New Rubric', created: new Date().toISOString(), criteria: [{ id: uid(), name: 'Criterion 1', tagIds: [], levels: { 4:'', 3:'', 2:'', 1:'' } }], _isNew: true };
    _rubricDirty = false; renderRubricEditor();
  }

  function editRubricUI(rubricId, activeCourse) {
    var rubric = getRubricById(activeCourse, rubricId); if (!rubric) return;
    _editingRubric = structuredClone(rubric); _rubricDirty = false; renderRubricEditor(activeCourse);
  }

  function deleteRubricUI(rubricId, activeCourse, callbacks) {
    var rubric = getRubricById(activeCourse, rubricId); if (!rubric) return;
    var linked = getAssessments(activeCourse).filter(function(a) { return a.rubricId === rubricId; }).length;
    var msg = linked > 0 ? '"' + rubric.name + '" is linked to ' + linked + ' assessment(s). They will lose their rubric link. Delete anyway?' : 'Delete rubric "' + rubric.name + '"?';
    showConfirm('Delete Rubric', msg, 'Delete', 'danger', function() { deleteRubric(activeCourse, rubricId); if (callbacks && callbacks.render) callbacks.render(); });
  }

  function renderRubricEditor(activeCourse) {
    if (!_editingRubric) return;
    var cid = activeCourse || getActiveCourse();
    var existing = document.getElementById('rubric-modal'); if (existing) existing.remove();
    var r = _editingRubric; var sections = getSections(cid);
    var html = '<div class="rubric-modal-overlay" id="rubric-modal" data-action="rubricModalBackdrop" role="dialog" aria-modal="true">' +
    '<div class="rubric-editor"><div class="rubric-editor-header"><h2 class="rubric-editor-title">' + (r._isNew ? 'New Rubric' : 'Edit Rubric') + '</h2>' +
    '<button class="rubric-editor-close" data-action="cancelRubricEdit" title="Close" aria-label="Close">\u2715</button></div>' +
    '<div class="rubric-editor-body"><input class="rubric-name-input" id="re-name" value="' + esc(r.name) + '" placeholder="Rubric name\u2026" aria-label="Rubric name"><div id="re-criteria">';
    r.criteria.forEach(function(crit, ci) { html += renderCriterionBlock(ci, crit, r.criteria, sections, cid); });
    html += '</div></div><div class="rubric-editor-footer"><button class="rubric-add-criterion-btn" data-action="addCriterion">+ Add Criterion</button>' +
    '<button class="btn btn-ghost" data-action="cancelRubricEdit">Cancel</button><button class="btn btn-primary" data-action="saveRubricEdit">Save Rubric</button></div></div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
    _critTagSection = {};
    setTimeout(function() { var inp = document.getElementById('re-name'); if (inp) inp.focus(); }, 50);
  }

  function renderCriterionBlock(ci, crit, allCriteria, sections, activeCourse) {
    var cid = activeCourse || getActiveCourse();
    var otherUsed = {}; allCriteria.forEach(function(c, i) { if (i !== ci) (c.tagIds||[]).forEach(function(t) { otherUsed[t] = c.name; }); });
    var selectedTagIds = new Set(crit.tagIds || []);
    var openSecId = _critTagSection[ci] || (sections[0] ? sections[0].id : '');
    var openSec = sections.find(function(s) { return s.id === openSecId; }) || sections[0];
    var isCollapsed = ci !== _expandedCriterion;
    var headerChips = ''; (crit.tagIds||[]).forEach(function(tid) { var sec = getSectionForTag(cid, tid); var color = sec ? sec.color : 'var(--text-3)'; headerChips += '<span class="rubric-header-chip" style="background:'+color+'20;color:'+color+';border:1px solid '+color+'30">'+esc(tid)+'</span>'; });
    var html = '<div class="rubric-criterion' + (isCollapsed?' collapsed':'') + '" data-crit-idx="' + ci + '"><div class="rubric-criterion-header" data-action="toggleCriterionExpand" data-index="' + ci + '">' +
      '<span class="rubric-criterion-num">' + (ci+1) + '</span><input class="rubric-criterion-name" value="' + esc(crit.name) + '" data-action-blur="critName" data-crit-idx="' + ci + '" data-stop-prop="true" placeholder="Criterion name">' +
      '<div class="rubric-header-chips">' + headerChips + '</div><span class="rubric-criterion-chevron">\u25BC</span>' +
      '<button class="rubric-criterion-delete" data-action="removeCriterion" data-index="' + ci + '" data-stop-prop="true" title="Remove criterion">\u2715</button></div>' +
      '<div class="rubric-criterion-body"><div class="rubric-selected-tags" id="re-sel-' + ci + '"><span class="rubric-selected-tags-label">Tags:</span>';
    if (selectedTagIds.size === 0) html += '<span class="rubric-no-tags">Click tags below to add them</span>';
    else (crit.tagIds||[]).forEach(function(tid) { var tag = getTagById(cid, tid); var sec = getSectionForTag(cid, tid); if (tag) html += '<span class="rubric-selected-chip" style="border-left:3px solid '+(sec?sec.color:'var(--text-3)')+'" data-action="toggleCritTag" data-index="'+ci+'" data-tagid="'+tid+'" title="Click to remove"><strong>'+esc(tid)+'</strong> <span class="chip-label">'+esc(tag.label)+'</span></span>'; });
    html += '</div><div class="rubric-tag-picker"><div class="rubric-tag-sections">';
    sections.forEach(function(sec) { var countInCrit = sec.tags.filter(function(t) { return selectedTagIds.has(t.id); }).length; html += '<button class="rubric-tag-sec-btn'+(sec.id===openSecId?' active':'')+'" data-action="switchCritSection" data-index="'+ci+'" data-secid="'+sec.id+'"><span class="rubric-tag-sec-dot" style="background:'+sec.color+'"></span>'+esc(sec.shortName||sec.name)+(countInCrit > 0 ? '<span class="rubric-tag-sec-count" style="color:'+sec.color+';font-weight:700">'+countInCrit+'</span>' : '')+'</button>'; });
    html += '</div><div class="rubric-tag-list" id="re-tags-' + ci + '">';
    if (openSec) openSec.tags.forEach(function(tag) { var inThis = selectedTagIds.has(tag.id); var inOtherName = otherUsed[tag.id]; var disabled = !!inOtherName; html += '<div class="rubric-tag-item'+(inThis?' selected':'')+(disabled?' disabled':'')+'" data-action="'+(disabled?'':'toggleCritTag')+'" data-index="'+ci+'" data-tagid="'+tag.id+'"><input type="checkbox" class="rubric-tag-cb" '+(inThis?'checked':'')+' '+(disabled?'disabled':'')+'><span class="rubric-tag-id" style="color:'+openSec.color+'">'+esc(tag.id)+'</span><span class="rubric-tag-label">'+esc(tag.label)+'</span>'+(disabled?'<span class="rubric-tag-used-by">in '+esc(inOtherName)+'</span>':'')+'</div>'; });
    html += '</div></div></div><div class="rubric-levels">' +
      '<div class="rubric-level-card"><div class="rubric-level-header"><span class="rubric-level-dot" style="background:var(--score-4)"></span> <span style="color:var(--score-4)">4 \u2014 Extending</span></div><textarea class="rubric-level-text" data-crit="'+ci+'" data-level="4" data-action-blur="critLevel" placeholder="What does extending look like?">'+esc((crit.levels&&crit.levels[4])||'')+'</textarea></div>' +
      '<div class="rubric-level-card"><div class="rubric-level-header"><span class="rubric-level-dot" style="background:var(--score-3)"></span> <span style="color:var(--score-3)">3 \u2014 Proficient</span></div><textarea class="rubric-level-text" data-crit="'+ci+'" data-level="3" data-action-blur="critLevel" placeholder="What does proficient look like?">'+esc((crit.levels&&crit.levels[3])||'')+'</textarea></div>' +
      '<div class="rubric-level-card"><div class="rubric-level-header"><span class="rubric-level-dot" style="background:var(--score-2)"></span> <span style="color:var(--score-2)">2 \u2014 Developing</span></div><textarea class="rubric-level-text" data-crit="'+ci+'" data-level="2" data-action-blur="critLevel" placeholder="What does developing look like?">'+esc((crit.levels&&crit.levels[2])||'')+'</textarea></div>' +
      '<div class="rubric-level-card"><div class="rubric-level-header"><span class="rubric-level-dot" style="background:var(--score-1)"></span> <span style="color:var(--score-1)">1 \u2014 Emerging</span></div><textarea class="rubric-level-text" data-crit="'+ci+'" data-level="1" data-action-blur="critLevel" placeholder="What does emerging look like?">'+esc((crit.levels&&crit.levels[1])||'')+'</textarea></div>' +
    '</div></div>';
    return html;
  }

  /* ── Criterion CRUD ───────────────────────────────────────── */
  function toggleCriterionExpand(idx) {
    _expandedCriterion = (_expandedCriterion === idx) ? -1 : idx;
    document.querySelectorAll('.rubric-criterion').forEach(function(el, i) {
      if (i === _expandedCriterion) el.classList.remove('collapsed'); else el.classList.add('collapsed');
    });
  }

  function updateCritName(idx, name) {
    if (!_editingRubric) return;
    _editingRubric.criteria[idx].name = name.trim() || 'Unnamed';
    _rubricDirty = true;
  }

  function updateCritLevel(idx, level, text) {
    if (!_editingRubric) return;
    if (!_editingRubric.criteria[idx].levels) _editingRubric.criteria[idx].levels = {};
    _editingRubric.criteria[idx].levels[level] = text.trim();
    _rubricDirty = true;
  }

  function toggleCritTag(critIdx, tagId, activeCourse) {
    if (!_editingRubric) return;
    _rubricDirty = true;
    var crit = _editingRubric.criteria[critIdx];
    if (!crit.tagIds) crit.tagIds = [];
    var i = crit.tagIds.indexOf(tagId);
    if (i >= 0) crit.tagIds.splice(i, 1); else crit.tagIds.push(tagId);
    _refreshCriterionDOM(critIdx, activeCourse);
  }

  function switchCritSection(critIdx, secId, activeCourse) {
    _critTagSection[critIdx] = secId;
    _refreshCriterionDOM(critIdx, activeCourse);
  }

  function _refreshCriterionDOM(ci, activeCourse) {
    if (!_editingRubric) return;
    var cid = activeCourse || getActiveCourse();
    var mount = document.getElementById('re-criteria'); if (!mount) return;
    var sections = getSections(cid); var h = '';
    _editingRubric.criteria.forEach(function(c, i) { h += renderCriterionBlock(i, c, _editingRubric.criteria, sections, cid); });
    mount.innerHTML = h;
  }

  function addCriterion(activeCourse) {
    if (!_editingRubric) return; _rubricDirty = true;
    var num = _editingRubric.criteria.length + 1;
    _editingRubric.criteria.push({ id: uid(), name: 'Criterion ' + num, tagIds: [], levels: { 4:'', 3:'', 2:'', 1:'' } });
    _expandedCriterion = _editingRubric.criteria.length - 1;
    _refreshCriterionDOM(_expandedCriterion, activeCourse);
  }

  function removeCriterion(idx, activeCourse) {
    if (!_editingRubric) return;
    if (_editingRubric.criteria.length <= 1) { alert('A rubric needs at least one criterion.'); return; }
    _rubricDirty = true; _editingRubric.criteria.splice(idx, 1);
    if (idx < _expandedCriterion) _expandedCriterion--; else if (idx === _expandedCriterion) _expandedCriterion = -1;
    _refreshCriterionDOM(0, activeCourse);
  }

  function cancelRubricEdit() {
    if (_rubricDirty && !confirm('Discard unsaved rubric changes?')) return;
    _editingRubric = null; _rubricDirty = false;
    var modal = document.getElementById('rubric-modal'); if (modal) modal.remove();
  }

  function saveRubricEdit(activeCourse, callbacks) {
    if (!_editingRubric) return;
    var cid = activeCourse || getActiveCourse();
    var nameInput = document.getElementById('re-name'); var rubricName = (nameInput ? nameInput.value : '').trim();
    if (!rubricName) { if (nameInput) { nameInput.style.border = '2px solid var(--score-1)'; nameInput.placeholder = 'Rubric name is required'; nameInput.focus(); } return; }
    _editingRubric.name = rubricName;
    if (!_editingRubric.criteria || _editingRubric.criteria.length === 0) { alert('Add at least one criterion.'); return; }
    for (var i = 0; i < _editingRubric.criteria.length; i++) { if (!_editingRubric.criteria[i].tagIds || _editingRubric.criteria[i].tagIds.length === 0) { alert('Criterion "' + _editingRubric.criteria[i].name + '" needs at least one tag.'); return; } }
    var rubrics = getRubrics(cid); var isNew = _editingRubric._isNew; delete _editingRubric._isNew;
    if (isNew) rubrics.push(_editingRubric); else { var idx = rubrics.findIndex(function(r) { return r.id === _editingRubric.id; }); if (idx >= 0) rubrics[idx] = _editingRubric; else rubrics.push(_editingRubric); }
    var savedId = _editingRubric.id; saveRubrics(cid, rubrics); _editingRubric = null; _rubricDirty = false;
    var modal = document.getElementById('rubric-modal'); if (modal) modal.remove();
    if (callbacks && callbacks.render) callbacks.render();
    setTimeout(function() {
      var dd = document.getElementById('af-rubric'); if (!dd) return;
      var freshRubrics = getRubrics(cid);
      dd.innerHTML = '<option value="">None</option>' + freshRubrics.map(function(r) { return '<option value="'+r.id+'">'+esc(r.name)+' ('+r.criteria.length+' criteria)</option>'; }).join('');
      if (isNew) {
        dd.value = savedId;
        if (callbacks && callbacks.onRubricSelect) callbacks.onRubricSelect(savedId);
      }
    }, 100);
  }

  function newRubricFromForm() { newRubricUI(); }

  /* ── Public API ───────────────────────────────────────────── */
  return {
    showDescriptorBar: showDescriptorBar,
    hideDescriptorBar: hideDescriptorBar,
    resetDescriptorBar: resetDescriptorBar,
    showCritTooltip: showCritTooltip,
    newRubricUI: newRubricUI,
    editRubricUI: editRubricUI,
    deleteRubricUI: deleteRubricUI,
    renderRubricEditor: renderRubricEditor,
    renderCriterionBlock: renderCriterionBlock,
    toggleCriterionExpand: toggleCriterionExpand,
    updateCritName: updateCritName,
    updateCritLevel: updateCritLevel,
    toggleCritTag: toggleCritTag,
    switchCritSection: switchCritSection,
    addCriterion: addCriterion,
    removeCriterion: removeCriterion,
    cancelRubricEdit: cancelRubricEdit,
    saveRubricEdit: saveRubricEdit,
    newRubricFromForm: newRubricFromForm,
    getEditingRubric: getEditingRubric,
    isRubricDirty: isRubricDirty,
    resetEditorState: resetEditorState
  };
})();
