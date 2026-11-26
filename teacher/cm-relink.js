// @ts-check
/* cm-relink.js — Class Settings: Re-link Curriculum. Moved from teacher/dash-class-manager.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. DashClassManager hands
   over what this file uses through configure(). It loads before dash-class-manager.js. */
/** @type {any} */ (window).CmRelink = (function () {
  'use strict';

  /* Handed over by DashClassManager (configure). */
  var _cwCourseCounts, renderClassManager, state, _cmLoose, _cmNorm, _cmOpenCompReview, _cmRenderCompReview, _cmStdCode;
  function configure(h) {
    if ('_cwCourseCounts' in h) _cwCourseCounts = h._cwCourseCounts;
    if ('renderClassManager' in h) renderClassManager = h.renderClassManager;
    if ('state' in h) state = h.state;
    if ('_cmLoose' in h) _cmLoose = h._cmLoose;
    if ('_cmNorm' in h) _cmNorm = h._cmNorm;
    if ('_cmOpenCompReview' in h) _cmOpenCompReview = h._cmOpenCompReview;
    if ('_cmRenderCompReview' in h) _cmRenderCompReview = h._cmRenderCompReview;
    if ('_cmStdCode' in h) _cmStdCode = h._cmStdCode;
  }

  /* ── Re-link Curriculum ─────────────────────────────────── */
  function cmStartRelink(cid) {
    state.cmRelinkCid = cid;
    state.cmRelinkStep = 1;
    state.cwSelectedGrade = null;
    state.cwSelectedSubject = null;
    var course = COURSES[cid];
    state.cwSelectedTags = course && course.curriculumTags ? course.curriculumTags.slice() : [];
    state.cwLoadError = false;
    Promise.all([loadCurriculumIndex(), _cmLoadCrosswalk()]).then(function (got) {
      var idx = got[0];
      state.cwCurriculumLoaded = !!idx;
      state.cwLoadError = !idx;
      if (idx) state.cwSelectedTags = _cmRelinkTags(state.cwSelectedTags, got[1]);
      renderClassManager();
    });
    renderClassManager();
  }

  /* The courses Re-link starts with: the class's own, less any the bank
     dropped. A dropped course whose successors are settled (Humanities 8 →
     ELA 8 + SS 8) brings them in; the others are listed for the teacher. */
  function _cmRelinkTags(tags, cw) {
    var out = [];
    tags.forEach(function (k) {
      var note = cw && cw.courses && cw.courses[k];
      if (/** @type {any} */ (CURRICULUM_INDEX)[k] || !note || !note.dropped) {
        if (/** @type {any} */ (CURRICULUM_INDEX)[k] && out.indexOf(k) < 0) out.push(k);
        return;
      }
      if (note.decided)
        note.successors.forEach(function (s) {
          if (/** @type {any} */ (CURRICULUM_INDEX)[s] && out.indexOf(s) < 0) out.push(s);
        });
    });
    return out;
  }

  /* The class's courses the bank no longer has, with what replaces them. */
  function _cmDroppedCourses(cid) {
    var cw = /** @type {any} */ (window)._CURRICULUM_CROSSWALK || state._cmCrosswalk;
    var tags = (COURSES[cid] && COURSES[cid].curriculumTags) || [];
    return tags
      .filter(function (k) {
        return CURRICULUM_INDEX && !CURRICULUM_INDEX[k] && cw && cw.courses && cw.courses[k] && cw.courses[k].dropped;
      })
      .map(function (k) {
        return Object.assign({ key: k }, cw.courses[k]);
      });
  }

  function cmRelinkCancel() {
    state.cmRelinkCid = null;
    state.cmRelinkStep = 0;
    state.cwSelectedTags = [];
    renderClassManager();
  }

  function cmRelinkNext() {
    if (!state.cmRelinkCid || state.cwSelectedTags.length === 0) return;
    state.cmRelinkStep = 2;
    _cmOpenCompReview(state.cmRelinkCid, _cmCurriculumCands(state.cwSelectedTags), {
      kind: 'curriculum',
      tags: state.cwSelectedTags.slice(),
    });
  }

  function renderCmRelinkPanel(cid) {
    var html = '';

    if (state.cmRelinkStep === 1) {
      html += '<div class="cm-section"><div class="cm-section-title">Re-link to BC Curriculum</div>';

      if (!state.cwCurriculumLoaded && !state.cwLoadError) {
        html += '<div class="cw-empty-msg">Loading BC Curriculum data\u2026</div>';
      } else if (state.cwLoadError) {
        html += '<div class="cw-empty-msg">Could not load BC Curriculum data.</div>';
      } else {
        _cmDroppedCourses(cid).forEach(function (d) {
          var names = d.successors
            .filter(function (k) {
              return /** @type {any} */ (CURRICULUM_INDEX)[k];
            })
            .map(function (k) {
              return /** @type {any} */ (CURRICULUM_INDEX)[k].course_name;
            });
          html +=
            '<div class="cm-hint cm-relink-dropped">' +
            esc(d.name) +
            ' is no longer a BC curriculum course. ' +
            (d.decided
              ? 'Its courses are ticked below: ' + esc(names.join(' and ')) + '.'
              : names.length
                ? 'The courses that replace it: ' + esc(names.join(', ')) + '. Tick the ones this class teaches.'
                : '') +
            '</div>';
        });
        html += '<div class="cm-field"><label class="cm-label">Grade</label><div class="cw-grade-row">';
        [8, 9, 10, 11, 12].forEach(function (g) {
          html +=
            '<button class="cw-grade-btn' +
            (state.cwSelectedGrade === g ? ' active' : '') +
            '" aria-pressed="' +
            (state.cwSelectedGrade === g) +
            '" data-action="cwSelectGrade" data-grade="' +
            g +
            '">Grade ' +
            g +
            '</button>';
        });
        html += '</div></div>';

        if (state.cwSelectedGrade) {
          var subjects = getSubjectsByGrade(state.cwSelectedGrade);
          html += '<div class="cm-field"><label class="cm-label">Subject</label><div class="cw-subject-row">';
          subjects.forEach(function (s) {
            html +=
              '<button class="cw-subject-btn' +
              (state.cwSelectedSubject === s ? ' active' : '') +
              '" aria-pressed="' +
              (state.cwSelectedSubject === s) +
              '" data-action="cwSelectSubject" data-subject="' +
              esc(s) +
              '">' +
              esc(s) +
              '</button>';
          });
          html += '</div></div>';

          var courses = getCoursesByGrade(state.cwSelectedGrade);
          if (state.cwSelectedSubject)
            courses = courses.filter(function (c) {
              return c.subject === state.cwSelectedSubject;
            });

          if (courses.length > 0) {
            html += '<div class="cm-field"><label class="cm-label">Courses</label><div class="cw-course-list">';
            courses.forEach(function (c) {
              var sel = state.cwSelectedTags.includes(c.short_tag) ? ' selected' : '';
              // Counted and named as the New Class wizard's course rows.
              var counts = _cwCourseCounts([c.short_tag]);
              html +=
                '<div class="cw-course-item' +
                sel +
                '" role="checkbox" tabindex="0" aria-checked="' +
                (sel ? 'true' : 'false') +
                '" data-action="cwToggleCourse" data-tag="' +
                esc(c.short_tag) +
                '">' +
                '<span class="cw-course-check">' +
                (sel ? '\u2713' : '') +
                '</span>' +
                '<span class="cw-course-name">' +
                esc(c.course_name) +
                '</span>' +
                '<span class="cw-course-tag">' +
                esc(c.short_tag) +
                '</span>' +
                '<span class="cw-course-count">' +
                counts.competencies +
                (counts.competencies === 1 ? ' Competency' : ' Competencies') +
                (counts.folders ? ' \u00B7 ' + counts.folders + (counts.folders === 1 ? ' Folder' : ' Folders') : '') +
                '</span>' +
                '</div>';
            });
            html += '</div></div>';
          }
        }

        if (state.cwSelectedTags.length > 0) {
          var totalComps = 0;
          state.cwSelectedTags.forEach(function (tag) {
            var full = /** @type {any} */ (CURRICULUM_INDEX)[tag];
            if (full && full.categories) {
              full.categories.forEach(function (cat) {
                totalComps += (cat.competencies || []).length;
              });
            }
          });
          html +=
            '<div class="cw-selection-summary"><strong>' +
            state.cwSelectedTags.length +
            '</strong> course' +
            (state.cwSelectedTags.length !== 1 ? 's' : '') +
            ' selected \u00B7 <strong>' +
            totalComps +
            '</strong> competencies</div>';
        }
      }

      html +=
        '<div class="cm-relink-actions">' +
        '<button class="btn btn-ghost" data-action="cmRelinkCancel">Cancel</button>' +
        '<button class="btn btn-primary" data-action="cmRelinkNext"' +
        (state.cwSelectedTags.length === 0 ? ' disabled style="opacity:0.5;pointer-events:none"' : '') +
        '>Next</button>' +
        '</div></div>';
    } else if (state.cmRelinkStep === 2) {
      html += _cmRenderCompReview(cid);
    }

    return html;
  }

  function _cmLoadCrosswalk() {
    if (/** @type {any} */ (window)._CURRICULUM_CROSSWALK)
      return Promise.resolve((state._cmCrosswalk = /** @type {any} */ (window)._CURRICULUM_CROSSWALK));
    if (state._cmCrosswalk) return Promise.resolve(state._cmCrosswalk);
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch('/curriculum_crosswalk.json')
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        state._cmCrosswalk = data;
        return data;
      })
      .catch(function () {
        return null;
      });
  }

  /* For each class competency no match took, the incoming competencies the
     crosswalk says replace it: by section index, a list of candidate
     indexes in the crosswalk's order. Matched by the old wording, else by
     the old code when only one old competency and only one of the class's
     has it. An old competency whose wording the Ministry kept (an "exact"
     row) isn't a replacement: the wording match takes it, and it's listed
     in exact so the review treats it as already matching. */
  function _cmCrosswalkPairs(cid, secs, live, cands, tags) {
    var cw = /** @type {any} */ (window)._CURRICULUM_CROSSWALK || state._cmCrosswalk;
    var out = { by: {}, exact: {}, match: {} };
    if (!cw || !cw.pairs) return out;
    var olds = ((COURSES[cid] && COURSES[cid].curriculumTags) || []).concat(tags);
    var rows = [];
    olds.forEach(function (k) {
      if (cw.pairs[k] && rows.indexOf(cw.pairs[k]) < 0) rows.push(cw.pairs[k]);
    });
    if (!rows.length) return out;
    rows = [].concat.apply([], rows);
    var freeCand = {};
    cands.forEach(function (c, ci) {
      if (live.pairs[ci] == null && c.bank_id) freeCand[c.bank_id] = ci;
    });
    function wordsOf(sec) {
      var tag = sec.tags[0];
      return [_cmNorm(tag.source_text), _cmNorm(tag.text)].filter(Boolean);
    }
    function codeOf(sec) {
      return _cmNorm(_cmStdCode(sec.tags[0]));
    }
    var byWording = secs.map(function (sec) {
      var words = wordsOf(sec);
      return (
        rows.find(function (r) {
          return words.indexOf(_cmNorm(r.raw)) >= 0;
        }) || null
      );
    });
    var codeCount = {};
    secs.forEach(function (sec) {
      var code = codeOf(sec);
      if (code) codeCount[code] = (codeCount[code] || 0) + 1;
    });
    secs.forEach(function (sec, si) {
      if (live.used[si]) return;
      var row = byWording[si];
      if (!row) {
        var code = codeOf(sec);
        var byCode = rows.filter(function (r) {
          return code && _cmNorm(r.code) === code;
        });
        if (byCode.length === 1 && codeCount[code] === 1 && byWording.indexOf(byCode[0]) < 0) row = byCode[0];
      }
      if (!row) return;
      var words = wordsOf(sec);
      var got = row.to
        .map(function (id) {
          return freeCand[id];
        })
        .filter(function (ci) {
          return ci != null;
        });
      if (!got.length) return;
      // The Ministry kept the wording: the same competency, matched here so
      // a trailing full stop can't split them.
      var same = got.find(function (ci) {
        return words.some(function (w) {
          return _cmLoose(w) === _cmLoose(cands[ci].text);
        });
      });
      if (same != null && (row.kind === 'exact' || row.to.length === 1)) {
        out.exact[si] = true;
        out.match[si] = same;
        delete freeCand[cands[same].bank_id];
        return;
      }
      got.forEach(function (ci) {
        delete freeCand[cands[ci].bank_id];
      });
      out.by[si] = got;
    });
    return out;
  }

  function _cmCurriculumCands(tags) {
    var built = buildLearningMapFromTags(tags) || { subjects: [], sections: [] };
    return (built.sections || []).map(function (sec) {
      var tag = sec.tags[0] || {};
      var group = (built.competencyGroups || []).find(function (g) {
        return g.id === sec.groupId;
      });
      return {
        code: tag.code || '',
        label: tag.label || '',
        text: tag.text || '',
        source_text: tag.source_text || '',
        icans: (tag.i_can_statements || []).slice(),
        bank_id: tag.bank_id || '',
        // Its Ministry folder, by name: the class's folder of that name
        // takes it.
        folder: group ? group.name : '',
        section: sec,
        subject: (built.subjects || []).find(function (s) {
          return s.id === sec.subject;
        }),
      };
    });
  }

  return {
    configure: configure,
    _cmCrosswalkPairs: _cmCrosswalkPairs,
    cmRelinkCancel: cmRelinkCancel,
    cmRelinkNext: cmRelinkNext,
    cmStartRelink: cmStartRelink,
    renderCmRelinkPanel: renderCmRelinkPanel,
  };
})();
