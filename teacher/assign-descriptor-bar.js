/* assign-descriptor-bar.js — the Assignments page's descriptor bar: a rubric level's or a competency level's wording while it is hovered, focused or held, on the class grid and in the grader.
   Moved from teacher/page-assignments.js on 2026-11-12; PageAssignments uses it through AssignDescriptorBar. */
window.AssignDescriptorBar = (function () {
  'use strict';

  /* What the Assignments page hands over on every call (configure): the class
     on screen and the two rubric helpers the bar uses, by the names it uses. */
  var activeCourse = null;
  var _rubricTagName, getRubricCriterion;
  function configure(page) {
    activeCourse = page.activeCourse;
    _rubricTagName = page._rubricTagName;
    getRubricCriterion = page.getRubricCriterion;
  }

  /* ── Descriptor bar ─────────────────────────────────────── */
  function _ensureDescriptorBar() {
    var bar = document.getElementById('rsg-descriptor-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'rsg-descriptor-bar';
      bar.id = 'rsg-descriptor-bar';
      bar.innerHTML =
        '<div class="rsg-descriptor-left"><span class="rsg-descriptor-label"></span><span class="rsg-descriptor-tags"></span></div><span class="rsg-descriptor-text"></span>';
      document.body.appendChild(bar);
      _resetDescriptorBarContent(bar);
    }
    // Where the student list is now, for assignments.css: the bar spans the
    // page beside the list, and is out of the way when the list is open over it.
    var layout = document.getElementById('page-layout');
    bar.classList.toggle('bar-wide', !!layout && layout.classList.contains('sidebar-hidden'));
    bar.classList.toggle('bar-covered', !!layout && layout.classList.contains('sidebar-overlay'));
    return bar;
  }
  // Idle, the bar is empty and out of sight: the card's own hint ("Hover a
  // level to see its wording") is the prompt.
  function _resetDescriptorBarContent(bar) {
    bar.querySelector('.rsg-descriptor-label').innerHTML = '';
    bar.querySelector('.rsg-descriptor-tags').innerHTML = '';
    bar.querySelector('.rsg-descriptor-text').innerHTML = '';
    bar.classList.add('is-idle');
  }
  function showDescriptorBar() {
    var bar = _ensureDescriptorBar();
    bar.style.display = 'flex';
  }
  function hideDescriptorBar() {
    var bar = document.getElementById('rsg-descriptor-bar');
    if (bar) bar.style.display = 'none';
    // A competency level's lines go too, so a rubric card shown next
    // starts from its own prompt.
    _clearTagLevelBar(bar);
  }
  function resetDescriptorBar() {
    var bar = document.getElementById('rsg-descriptor-bar');
    if (bar) _resetDescriptorBarContent(bar);
  }
  /* A competency's level on the class grid (renderTagGrid): its three
     lines (CompetencyWording) in the descriptor bar, shown while the level
     is hovered or focused. The bar is fixed over the page, so nothing
     moves. A bank competency's wording loads the first time; the lines
     fill again once it is here, while the level is still under the
     pointer. */
  var _tagBarLevel = null;
  var _tagBarShown = false;
  var _tagBarHide = null;
  var _bankLoadAsked = false;
  function showTagLevelBar(el) {
    clearTimeout(_tagBarHide);
    var grader = el.classList.contains('grdl-level');
    var tag = getTagById(activeCourse, grader ? el.dataset.tag : el.dataset.tagid);
    var l = window.CompetencyWording ? CompetencyWording.lines(tag, parseInt(el.dataset.level, 10)) : null;
    var lines = l ? CompetencyWording.html(l) : '';
    if (!lines) return;
    if (grader) _showGraderLevelBar(el, lines);
    else _showGridLevelBar(el, tag, lines);
    // Asked once: offline, the bar keeps the other wording rather than
    // adding the script again on every hover.
    if (!l.ready && !_bankLoadAsked && window.RubricPrint && RubricPrint.loadBankLevels) {
      _bankLoadAsked = true;
      RubricPrint.loadBankLevels().then(function (ok) {
        if (ok && _tagBarLevel === el && document.body.contains(el)) showTagLevelBar(el);
      });
    }
  }
  /* In the grader the lines sit in a bar over the dialog's foot (the
     card names the competency), so the dialog doesn't change size. */
  function _showGraderLevelBar(el, lines) {
    var dlg = el.closest('.grader-dialog');
    if (!dlg) return;
    var bar = dlg.querySelector('.grdl-wording-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'grdl-wording-bar';
      dlg.appendChild(bar);
    }
    _tagBarLevel = el;
    // html-safe: CompetencyWording.html escapes the descriptor, I Can statements and step
    bar.innerHTML = lines;
    bar.hidden = false;
  }
  function _showGridLevelBar(el, tag, lines) {
    var bar = _ensureDescriptorBar();
    bar.classList.add('is-lines');
    bar.classList.remove('is-idle');
    if (bar.style.display !== 'flex') {
      bar.style.display = 'flex';
      _tagBarShown = true;
    }
    _tagBarLevel = el;
    // html-safe: the competency's label through esc; the lines escape their own text (CompetencyWording.html)
    bar.querySelector('.rsg-descriptor-label').innerHTML = esc(
      _rubricTagName(tag, getSectionForTag(activeCourse, tag.id)),
    );
    bar.querySelector('.rsg-descriptor-tags').innerHTML = '';
    var text = bar.querySelector('.rsg-descriptor-text');
    text.classList.add('is-lines');
    // html-safe: CompetencyWording.html escapes the descriptor, I Can statements and step
    text.innerHTML = lines;
  }
  /* Leaving a level: after this event, so moving straight to the next
     level (which shows its own lines) doesn't flash the bar. */
  function hideTagLevelBar() {
    clearTimeout(_tagBarHide);
    _tagBarHide = setTimeout(function () {
      if (!_tagBarLevel) return;
      var bar = document.getElementById('rsg-descriptor-bar');
      if (bar && _tagBarShown) bar.style.display = 'none';
      _clearTagLevelBar(bar);
    }, 0);
  }
  function _clearTagLevelBar(bar) {
    _tagBarLevel = null;
    _tagBarShown = false;
    document.querySelectorAll('.grdl-wording-bar').forEach(function (b) {
      b.hidden = true;
    });
    if (!bar || !bar.classList.contains('is-lines')) return;
    bar.classList.remove('is-lines');
    bar.querySelector('.rsg-descriptor-text').classList.remove('is-lines');
    _resetDescriptorBarContent(bar);
  }

  function showCritTooltip(event, aid, critId, level) {
    var crit = getRubricCriterion(aid, critId);
    if (!crit || !crit.levels || !crit.levels[level]) return;
    var levelNames = PROF_LABELS;
    var levelColors = { 4: 'var(--score-4)', 3: 'var(--score-3)', 2: 'var(--score-2)', 1: 'var(--score-1)' };
    var bar = _ensureDescriptorBar();
    // html-safe: criterion name and level name through esc; colour from a fixed map
    bar.querySelector('.rsg-descriptor-label').innerHTML =
      esc(crit.name) +
      ' <span style="color:' +
      (levelColors[level] || 'var(--text-3)') +
      '">\u2014 ' +
      esc(levelNames[level] || level) +
      '</span>';
    var tagsHtml = (crit.tagIds || [])
      .map(function (tid) {
        var tag = getTagById(activeCourse, tid);
        var sec = getSectionForTag(activeCourse, tid);
        var color = cssColor(sec ? sec.color : 'var(--text-3)');
        // The section colour as text goes through tintText(), as every
        // small coloured label does, so it reads on the bar (4.5:1).
        return (
          '<span class="rsg-descriptor-tag" style="border-color:' +
          color +
          ';color:' +
          tintText(color) +
          '">' +
          esc(_rubricTagName(tag, sec)) +
          '</span>'
        );
      })
      .join('');
    if (!tagsHtml) tagsHtml = '<span class="rsg-descriptor-tag rsg-descriptor-tag-overall">Overall grade only</span>';
    bar.querySelector('.rsg-descriptor-tags').innerHTML = tagsHtml;
    bar.querySelector('.rsg-descriptor-text').textContent = crit.levels[level];
    bar.classList.remove('is-idle');
  }

  // The competency level whose lines are showing (the page's mouseover reads it).
  function tagBarLevel() {
    return _tagBarLevel;
  }

  return {
    configure: configure,
    showDescriptorBar: showDescriptorBar,
    hideDescriptorBar: hideDescriptorBar,
    resetDescriptorBar: resetDescriptorBar,
    showTagLevelBar: showTagLevelBar,
    hideTagLevelBar: hideTagLevelBar,
    _clearTagLevelBar: _clearTagLevelBar,
    showCritTooltip: showCritTooltip,
    tagBarLevel: tagBarLevel,
  };
})();
