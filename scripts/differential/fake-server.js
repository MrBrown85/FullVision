/* global window -- runs in the app page. */
/**
 * The differential run's fake server, laid over the fake Supabase client of
 * e2e/helpers.js (mockAuth) in every signed-in page, after it (an init
 * script). mockAuth answers the class bundle from what the page held when it
 * loaded and every write with nothing; this adds what a run needs to reach
 * the code a teacher's marks go through, without changing mockAuth:
 *
 * - THE CALL LOG. Every call is written to localStorage as it is made, one
 *   key a call (`__diff-call-<page load>-<n>`), so the run can read the
 *   calls of a page that has since reloaded or closed (probe.mjs
 *   takeOwnCalls, takeLeftCalls). mockAuth's own log starts again on every
 *   page load and dies with the page.
 * - SERVER IDS. A create is answered with the id the server would give
 *   (create_assessment, create_student_and_enroll, save_categories), made
 *   from the call's idempotency key, so it is the same in build A and build
 *   B and the same when a create is sent twice. The app then re-keys its
 *   local id, as it does live.
 * - DRAFT AND RETURNED. The class's student page is on and it returns grades
 *   When I Return Them (fixtures.mjs seeds the server's settings; the class
 *   bundle carries them, as live). The server keeps the class's Draft and
 *   Returned rows: each time a write lands it takes the rows the device
 *   holds then as its own, and list_course_grade_returns answers with them.
 *   A write that fails or is refused leaves the server's rows as they were.
 *   The rule that makes a row is the device's (shared/grade-state.js); the
 *   fake does not work it out a second time. return_grades and return_work
 *   answer as live; one can be told to refuse (window.__diffRefuseReturns),
 *   which is how the run reaches the outbox's refusal handling. Send Work,
 *   Return for Revision and Take Back are kept the same way.
 * - CATEGORIES. list_categories answers with the class's categories as the
 *   server holds them: the bundle's list the first time the class is
 *   served, then whatever the last save_categories that landed left.
 *
 * What it keeps is in localStorage under `__diff-srv-`, one key a record, so
 * a reload and a second tab see the same server. The run's comparison leaves
 * every `__diff-` key out.
 */
// eslint-disable-next-line no-unused-vars
function differentialFakeServer() {
  var client = window._supabase;
  if (!client || typeof client.rpc !== 'function') return;
  var real = client.rpc;
  var ls = window.localStorage;
  var SRV = '__diff-srv-';
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var sent = 0;

  function read(key, fallback) {
    try {
      var raw = ls.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    ls.setItem(key, JSON.stringify(value));
  }
  function log(name, params) {
    sent++;
    ls.setItem(
      '__diff-call-' + window.__diffTab + '-' + ('000000' + sent).slice(-6),
      JSON.stringify({ name: name, params: params === undefined ? null : params }),
    );
  }
  // An id as the server would make it: the same for the same call.
  function hash(text, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }
  function serverId(kind, key, index) {
    var text = kind + '|' + key + '|' + (index || 0);
    var h = hash(text, 2166136261) + hash(text, 40503) + hash(text, 2654435761) + hash(text, 97);
    return (
      h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-8' + h.slice(17, 20) + '-' + h.slice(20, 32)
    );
  }
  function keyOf(params) {
    return (params && params.p_idempotency_key) || JSON.stringify(params || null);
  }

  // ── The class's settings, as the server holds them ──
  function courseOf(cid) {
    return read(SRV + 'course-' + cid, null);
  }
  function holdingCourses() {
    var out = [];
    for (var i = 0; i < ls.length; i++) {
      var k = ls.key(i);
      if (!k || k.indexOf(SRV + 'course-') !== 0) continue;
      var c = read(k, null);
      if (c && c.student_page_enabled === true) out.push(k.slice((SRV + 'course-').length));
    }
    return out.sort();
  }
  // The device's rows become the server's: a write has landed.
  function keepRows() {
    holdingCourses().forEach(function (cid) {
      var raw = ls.getItem('gb-grade-returns-' + cid);
      ls.setItem(SRV + 'rows-' + cid, raw == null ? '{}' : raw);
    });
  }
  function revisions() {
    var out = [];
    for (var i = 0; i < ls.length; i++) {
      var k = ls.key(i);
      if (k && k.indexOf(SRV + 'rev-') === 0) out.push(read(k, null));
    }
    return out.filter(Boolean).sort(function (a, b) {
      return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1;
    });
  }

  // ── The class's categories, as list_categories returns them ──
  // Taken from the class bundle the first time a class is served, then
  // changed only by a save_categories that lands (the real function replaces
  // the class's list: rows not named are deleted, named rows keep their
  // created_at, order is the list's order).
  function categoriesOf(cid) {
    return read(SRV + 'cats-' + cid, null);
  }
  function takeBundleCategories(cid, rows) {
    if (categoriesOf(cid) !== null || !Array.isArray(rows)) return;
    var at = new Date().toISOString();
    write(
      SRV + 'cats-' + cid,
      rows.map(function (r, i) {
        return {
          id: r.id,
          course_id: cid,
          name: r.name || '',
          weight: r.weight || 0,
          display_order: r.display_order != null ? r.display_order : i,
          calc_mode: r.calc_mode === 'percent' ? 'percent' : 'points',
          created_at: at,
          updated_at: at,
        };
      }),
    );
  }
  function keepCategories(cid, wanted, ids, now) {
    var had = {};
    (categoriesOf(cid) || []).forEach(function (r) {
      had[r.id] = r;
    });
    write(
      SRV + 'cats-' + cid,
      wanted.map(function (c, i) {
        var old = had[ids[i]];
        var mode = c && c.calc_mode;
        return {
          id: ids[i],
          course_id: cid,
          name: String((c && c.name) || '').trim(),
          weight: Number(c && c.weight) || 0,
          display_order: i,
          calc_mode: mode === 'points' || mode === 'percent' ? mode : old ? old.calc_mode : 'points',
          created_at: old ? old.created_at : now,
          updated_at: now,
        };
      }),
    );
  }

  /* What a write answers with once it has landed, or undefined to leave
     mockAuth's answer (nothing). */
  function landed(name, params) {
    var key = keyOf(params);
    var now = new Date().toISOString();
    if (name === 'create_assessment') return serverId('assessment', key);
    if (name === 'create_student_and_enroll') {
      return {
        student_id: UUID.test(params.p_existing_student_id || '')
          ? params.p_existing_student_id
          : serverId('person', key),
        enrollment_id: serverId('enrollment', key),
      };
    }
    if (name === 'save_categories') {
      var ids = (params.p_categories || []).map(function (c, i) {
        return c && UUID.test(c.id || '') ? c.id : serverId('category', key, i);
      });
      keepCategories(params.p_course_id, params.p_categories || [], ids, now);
      return ids;
    }
    if (name === 'update_course') {
      var patch = params.p_patch || {};
      var course = courseOf(params.p_course_id) || {};
      ['student_page_enabled', 'return_grades'].forEach(function (f) {
        if (f in patch) course[f] = patch[f];
      });
      write(SRV + 'course-' + params.p_course_id, course);
      return undefined;
    }
    if (name === 'set_course_send_work') {
      var c = courseOf(params.p_course_id) || {};
      if (params.p_patch && 'send_work' in params.p_patch) c.send_work = params.p_patch.send_work === true;
      write(SRV + 'course-' + params.p_course_id, c);
      return { send_work: c.send_work === true, keep_photos_until: 'end_of_year' };
    }
    if (name === 'return_grades' || name === 'return_work') {
      var enrolled = params.p_enrollment_ids || [];
      return { returned: enrolled.length, enrollment_ids: enrolled, returned_at: now };
    }
    if (name === 'return_for_revision') {
      var open = revisions().find(function (r) {
        return (
          r.assessment_id === params.p_assessment_id && r.enrollment_id === params.p_enrollment_id && r.state === 'open'
        );
      });
      if (open) return { result: 'already_open', request: open };
      var req = params.p_request || {};
      var row = {
        id: serverId('revision', key),
        assessment_id: params.p_assessment_id,
        enrollment_id: params.p_enrollment_id,
        what_to_fix: req.what_to_fix,
        revise_by: req.revise_by || null,
        criterion_ids: req.criterion_ids || [],
        keep_grade: true,
        grade_hidden: false,
        first_submission_id: null,
        first_version: 1,
        first_grade: null,
        first_returned_at: now,
        created_at: now,
        updated_at: now,
        closed_at: null,
        state: 'open',
        revision_submission_id: null,
        revision_version: null,
        revision_sent_at: null,
        revision_note: null,
        revision_late: null,
        revision_sent_by: null,
      };
      write(SRV + 'rev-' + row.id, row);
      return { result: 'made', request: row, returned: {}, hidden: false };
    }
    if (name === 'cancel_revision') {
      var found = read(SRV + 'rev-' + params.p_request_id, null);
      if (!found || found.state !== 'open') return { result: 'not_open' };
      found.state = 'cancelled';
      found.closed_at = found.updated_at = now;
      write(SRV + 'rev-' + found.id, found);
      return { result: 'cancelled', request: found, unhidden: false };
    }
    return undefined;
  }

  /* What a read answers with, or undefined to leave mockAuth's answer. */
  function readAnswer(name, params) {
    if (name === 'list_course_grade_returns') return read(SRV + 'rows-' + params.p_course_id, {}) || {};
    if (name === 'list_course_submissions') {
      var c = courseOf(params.p_course_id) || {};
      return {
        bucket: 'student-photos',
        course: { send_work: c.send_work === true, keep_photos_until: 'end_of_year' },
        assessments: [],
        submissions: [],
        uploads: [],
      };
    }
    if (name === 'list_course_feedback') {
      return {
        course: { reflect_on_feedback: false, show_my_learning: false },
        markup: [],
        revisions: revisions(),
        reflections: [],
      };
    }
    if (name === 'list_assessment_markup') return [];
    if (name === 'list_categories') {
      return (categoriesOf(params.p_course_id) || []).slice().sort(function (a, b) {
        return (
          a.display_order - b.display_order || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)
        );
      });
    }
    return undefined;
  }

  client.rpc = function (name, params) {
    log(name, params);
    var p = params || {};
    if (name === 'get_class_bundle') {
      // The student page's switch, Return Grades and Send Work come on the
      // course row, as live.
      return real.call(client, name, params).then(function (res) {
        var course = courseOf(p.p_course_id);
        if (res && res.data && res.data.gradebook) takeBundleCategories(p.p_course_id, res.data.gradebook.categories);
        if (course && res && res.data && res.data.gradebook && res.data.gradebook.course) {
          Object.assign(res.data.gradebook.course, {
            student_page_enabled: course.student_page_enabled === true,
            return_grades: course.return_grades || null,
            send_work: course.send_work === true,
            keep_photos_until: 'end_of_year',
          });
        }
        return res;
      });
    }
    if (/^(get|list)_/.test(name)) {
      var answer = readAnswer(name, p);
      // mockAuth still logs the call in its own list.
      return answer === undefined
        ? real.call(client, name, params)
        : real.call(client, name, params).then(function () {
            return { data: answer, error: null };
          });
    }
    // A write. Offline (the run sets mockAuth's switch) it fails as
    // mockAuth fails it; a Return can be told to be refused.
    if (window.__e2eFailWrites) return real.call(client, name, params);
    if ((name === 'return_grades' || name === 'return_work') && window.__diffRefuseReturns > 0) {
      window.__diffRefuseReturns--;
      return real.call(client, name, params).then(function () {
        return { data: null, error: { message: 'permission denied for this class', code: '42501' }, status: 403 };
      });
    }
    return real.call(client, name, params).then(function (res) {
      if (res && res.error) return res;
      var data = landed(name, p);
      keepRows();
      return data === undefined ? res : { data: data, error: null };
    });
  };
  // Named so a reader of the page can tell the two apart.
  client.rpc.differential = true;
}
