/* Student questionnaires: a class's forms, from the server or, in Demo
   Mode, this device (docs/STUDENT-VOICE-PLAN.md, PR 5).

   A signed-in class reads and writes the questionnaire tables through the
   v2 wrappers (migrations/20261025_questionnaires_tables_and_functions.sql).
   Demo Mode keeps the same shapes in localStorage under
   gb-questionnaires-<cid>, so the Questionnaires tab works there too; a
   signed-in class never falls back to a device copy, so no local id ever
   reaches the database. The templates come from the server, or from
   shared/questionnaire-templates.js when it can't be read. */
var Questionnaires = (function () {
  'use strict';

  var _byCourse = {}; // cid -> [questionnaire]
  var _loading = {}; // cid -> Promise
  var _templates = null;

  function _demo() {
    return typeof isDemoMode === 'function' && isDemoMode();
  }

  function _localKey(cid) {
    return 'gb-questionnaires-' + cid;
  }

  function _readLocal(cid) {
    try {
      var raw = localStorage.getItem(_localKey(cid));
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function _writeLocal(cid, list) {
    try {
      localStorage.setItem(_localKey(cid), JSON.stringify(list));
    } catch (e) {
      /* a full device keeps the copy in memory for this visit */
    }
  }

  function _localId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function templates() {
    return _templates || (typeof QUESTIONNAIRE_TEMPLATES !== 'undefined' ? QUESTIONNAIRE_TEMPLATES : []);
  }

  function template(id) {
    return (
      templates().find(function (t) {
        return t.id === id;
      }) || null
    );
  }

  /* The reflection template for a grade and reporting period (1 November,
     2 March, 3 June). */
  function reflectionTemplate(grade, period) {
    return template('core-' + grade + '-' + period);
  }

  /* The class's grade as a number 8–12, or null for a range or none. */
  function courseGrade(course) {
    var m = /^\s*(\d{1,2})\s*$/.exec(String((course && course.gradeLevel) || ''));
    var g = m ? Number(m[1]) : null;
    return g >= 8 && g <= 12 ? g : null;
  }

  /* The reporting period a date falls in: September–December November's,
     January–March March's, April onward June's. */
  function periodFor(date) {
    var m = (date || new Date()).getMonth() + 1;
    if (m >= 9) return 1;
    if (m <= 3) return 2;
    return 3;
  }

  function list(cid) {
    return _byCourse[cid] || [];
  }

  function loaded(cid) {
    return Object.prototype.hasOwnProperty.call(_byCourse, cid);
  }

  /* Reads the class's questionnaires (and the templates, once). Resolves
     with the list; calls onChange when anything new arrived. */
  function load(cid, onChange) {
    if (!cid) return Promise.resolve([]);
    if (_demo()) {
      _byCourse[cid] = _readLocal(cid);
      return Promise.resolve(_byCourse[cid]);
    }
    if (_loading[cid]) return _loading[cid];
    var v2 = window.v2 || {};
    var tpl =
      _templates || !v2.listQuestionnaireTemplates
        ? Promise.resolve(null)
        : v2.listQuestionnaireTemplates().then(function (res) {
            if (res && res.data && res.data.length) _templates = res.data;
          });
    var mine = v2.listCourseQuestionnaires
      ? v2.listCourseQuestionnaires(cid).then(function (res) {
          if (res && res.data) _byCourse[cid] = res.data;
        })
      : Promise.resolve();
    _loading[cid] = Promise.all([tpl, mine]).then(function () {
      delete _loading[cid];
      if (!loaded(cid)) _byCourse[cid] = [];
      if (onChange) onChange(cid);
      return _byCourse[cid];
    });
    return _loading[cid];
  }

  function find(cid, pred) {
    return list(cid).find(pred) || null;
  }

  function _replace(cid, q) {
    var all = list(cid).filter(function (x) {
      return x.id !== q.id;
    });
    all.push(q);
    _byCourse[cid] = all;
    if (_demo()) _writeLocal(cid, all);
    return q;
  }

  function _questionsFrom(tpl) {
    return ((tpl && tpl.questions) || []).map(function (q, i) {
      return Object.assign(
        {
          id: _localId('qq'),
          display_order: i + 1,
          options: {},
          core_ids: [],
          repeated_key: null,
          teacher_only: false,
          prompt_translations: {},
        },
        JSON.parse(JSON.stringify(q)),
      );
    });
  }

  /* Saves a whole questionnaire: { id?, kind, title, template_id, theme,
     report_period, parent_id, opens_on, closes_on, is_on, myed_comment,
     questions }. questions null on a new one copies its template's. */
  function save(cid, q) {
    if (_demo()) {
      var tpl = q.template_id ? template(q.template_id) : null;
      var now = new Date().toISOString();
      var prev = q.id ? find(cid, x => x.id === q.id) : null;
      var saved = Object.assign({}, prev || {}, q, {
        id: q.id || _localId('q'),
        course_id: cid,
        theme: q.theme != null ? q.theme : tpl ? tpl.theme : null,
        myed_comment: q.myed_comment != null ? q.myed_comment : tpl ? tpl.myed_comment : null,
        questions: Array.isArray(q.questions)
          ? q.questions.map(function (x, i) {
              return Object.assign({ id: _localId('qq') }, x, { display_order: i + 1 });
            })
          : prev
            ? prev.questions
            : _questionsFrom(tpl),
        answered: (prev && prev.answered) || [],
        updated_at: now,
        created_at: (prev && prev.created_at) || now,
      });
      return Promise.resolve(_replace(cid, saved));
    }
    var v2 = window.v2 || {};
    if (!v2.upsertQuestionnaire) return Promise.resolve(null);
    var serverQs = Array.isArray(q.questions)
      ? q.questions.map(function (x) {
          var out = {
            prompt: x.prompt,
            kind: x.kind,
            options: x.options || {},
            core_ids: x.core_ids || [],
            repeated_key: x.repeated_key || null,
            teacher_only: !!x.teacher_only,
            prompt_translations: x.prompt_translations || {},
          };
          if (/^[0-9a-f-]{36}$/i.test(x.id || '')) out.id = x.id;
          return out;
        })
      : null;
    return v2
      .upsertQuestionnaire({
        id: q.id,
        courseId: cid,
        kind: q.kind,
        title: q.title,
        templateId: q.template_id,
        theme: q.theme,
        reportPeriod: q.report_period,
        parentId: q.parent_id,
        opensOn: q.opens_on,
        closesOn: q.closes_on,
        isOn: q.is_on !== false,
        myedComment: q.myed_comment,
        questions: serverQs,
      })
      .then(function (res) {
        var row = res && res.data;
        if (!row || !row.id) return null;
        var prev = find(cid, x => x.id === row.id);
        row.answered = (prev && prev.answered) || [];
        return _replace(cid, row);
      });
  }

  /* Turns a questionnaire on, creating it from its template the first time. */
  function turnOn(cid, spec) {
    var existing = spec.id ? find(cid, x => x.id === spec.id) : null;
    if (existing) return setOn(cid, existing.id, true);
    var tpl = template(spec.template_id);
    return save(cid, {
      kind: spec.kind || (tpl && tpl.kind),
      title: spec.title || (tpl && tpl.title) || 'Questionnaire',
      template_id: spec.template_id,
      report_period: spec.report_period || null,
      parent_id: spec.parent_id || null,
      opens_on: spec.opens_on || null,
      closes_on: spec.closes_on || null,
      is_on: true,
      questions: null,
    });
  }

  function setOn(cid, id, on) {
    var q = find(cid, x => x.id === id);
    if (!q) return Promise.resolve(null);
    q.is_on = !!on;
    if (_demo()) return Promise.resolve(_replace(cid, q));
    var v2 = window.v2 || {};
    return (v2.setQuestionnaireOn ? v2.setQuestionnaireOn(id, on) : Promise.resolve()).then(function () {
      return q;
    });
  }

  /* Codes for the printed slips: [{ enrollment_id, code }]. Demo Mode makes
     them up; nothing checks them there. */
  var CODE_ABC = 'ABCDEFGHJKMNPQRTUVWXYZ2346789';
  function _demoCode() {
    var s = '';
    for (var i = 0; i < 6; i++) s += CODE_ABC.charAt(Math.floor(Math.random() * CODE_ABC.length));
    return s.slice(0, 3) + '-' + s.slice(3);
  }

  function issueCodes(cid, qid, enrollmentIds) {
    if (_demo()) {
      var ids =
        enrollmentIds && enrollmentIds.length
          ? enrollmentIds
          : getStudents(cid).map(function (s) {
              return s.id;
            });
      return Promise.resolve({
        data: ids.map(function (id) {
          return { enrollment_id: id, code: _demoCode() };
        }),
        error: null,
      });
    }
    var v2 = window.v2 || {};
    if (!v2.issueAccessCodes) return Promise.resolve({ data: null, error: { message: 'unavailable' } });
    return v2.issueAccessCodes(qid, enrollmentIds);
  }

  /* Open, opens, closed or off, as a short status and its state. */
  function status(q, today) {
    var d = today || new Date().toISOString().slice(0, 10);
    var fmt = function (iso) {
      var t = new Date(iso + 'T12:00:00');
      return isNaN(t) ? iso : t.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
    };
    if (!q || !q.is_on) return { state: 'off', text: 'Off' };
    if (q.opens_on && q.opens_on > d) return { state: 'upcoming', text: 'Opens ' + fmt(q.opens_on) };
    if (q.closes_on && q.closes_on < d) return { state: 'closed', text: 'Closed ' + fmt(q.closes_on) };
    return { state: 'open', text: q.closes_on ? 'Open until ' + fmt(q.closes_on) : 'Open' };
  }

  function _reset() {
    _byCourse = {};
    _loading = {};
    _templates = null;
  }

  return {
    templates: templates,
    template: template,
    reflectionTemplate: reflectionTemplate,
    courseGrade: courseGrade,
    periodFor: periodFor,
    list: list,
    loaded: loaded,
    load: load,
    find: find,
    save: save,
    turnOn: turnOn,
    setOn: setOn,
    issueCodes: issueCodes,
    status: status,
    _reset: _reset,
  };
})();
if (typeof window !== 'undefined') window.Questionnaires = Questionnaires;
