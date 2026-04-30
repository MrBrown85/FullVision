/**
 * Direct database introspection helpers for real-Supabase tests.
 *
 * Tests assert against the database — not against the localStorage cache,
 * not against the UI render. This is what makes a "persistence" test real:
 * if the row isn't in Supabase, the data doesn't survive sign-out, end of
 * story.
 */

/**
 * Roll up row counts across every entity scoped to a course. Accepts
 * either a courseName (polls course table until row appears) or a known
 * courseId (skips the lookup). The poll exists because createCourse fires
 * its RPC unawaited; tests created via createTestCourse already have the
 * canonical UUID and can pass it directly.
 */
export async function readCourseRowCounts(page, courseNameOrOpts, opts) {
  const isObj = courseNameOrOpts && typeof courseNameOrOpts === 'object';
  const args = isObj ? courseNameOrOpts : { name: courseNameOrOpts, ...opts };
  return page.evaluate(async ({ name, courseId, timeoutMs }) => {
    const sb = window._supabase;
    if (!sb) return null;
    let cid = courseId || null;
    if (!cid && name) {
      const deadline = Date.now() + (timeoutMs || 15_000);
      while (Date.now() < deadline) {
        const r = await sb.from('course').select('id').eq('name', name).maybeSingle();
        if (r.data && r.data.id) {
          cid = r.data.id;
          break;
        }
        await new Promise(res => setTimeout(res, 250));
      }
    }
    if (!cid) return { found: false, courseName: name };
    const [
      enr,
      cat,
      sub,
      sec,
      tags,
      asmts,
      scores,
      obs,
      rubrics,
      mods,
      notes,
      goals,
      refls,
      terms,
      tagScores,
      customTags,
      overrides,
    ] = await Promise.all([
      sb.from('enrollment').select('id', { count: 'exact', head: true }).eq('course_id', cid),
      sb.from('category').select('id', { count: 'exact', head: true }).eq('course_id', cid),
      sb.from('subject').select('id', { count: 'exact', head: true }).eq('course_id', cid),
      sb.from('section').select('id', { count: 'exact', head: true }).eq('course_id', cid),
      sb
        .from('tag')
        .select('id, section!inner(course_id)', { count: 'exact', head: true })
        .eq('section.course_id', cid),
      sb.from('assessment').select('id', { count: 'exact', head: true }).eq('course_id', cid),
      sb
        .from('score')
        .select('value, assessment!inner(course_id)', { count: 'exact', head: true })
        .eq('assessment.course_id', cid),
      sb.from('observation').select('id', { count: 'exact', head: true }).eq('course_id', cid),
      sb.from('rubric').select('id', { count: 'exact', head: true }).eq('course_id', cid),
      sb.from('module').select('id', { count: 'exact', head: true }).eq('course_id', cid),
      sb
        .from('note')
        .select('id, enrollment!inner(course_id)', { count: 'exact', head: true })
        .eq('enrollment.course_id', cid),
      sb
        .from('goal')
        .select('id, enrollment!inner(course_id)', { count: 'exact', head: true })
        .eq('enrollment.course_id', cid),
      sb
        .from('reflection')
        .select('id, enrollment!inner(course_id)', { count: 'exact', head: true })
        .eq('enrollment.course_id', cid),
      sb
        .from('term_rating')
        .select('id, enrollment!inner(course_id)', { count: 'exact', head: true })
        .eq('enrollment.course_id', cid),
      sb
        .from('tag_score')
        .select('value, assessment!inner(course_id)', { count: 'exact', head: true })
        .eq('assessment.course_id', cid),
      sb.from('custom_tag').select('id', { count: 'exact', head: true }).eq('course_id', cid),
      sb
        .from('section_override')
        .select('id, enrollment!inner(course_id)', { count: 'exact', head: true })
        .eq('enrollment.course_id', cid),
    ]);
    return {
      found: true,
      courseId: cid,
      enrollments: enr.count || 0,
      categories: cat.count || 0,
      subjects: sub.count || 0,
      sections: sec.count || 0,
      tags: tags.count || 0,
      assessments: asmts.count || 0,
      scores: scores.count || 0,
      observations: obs.count || 0,
      rubrics: rubrics.count || 0,
      modules: mods.count || 0,
      notes: notes.count || 0,
      goals: goals.count || 0,
      reflections: refls.count || 0,
      termRatings: terms.count || 0,
      tagScores: tagScores.count || 0,
      customTags: customTags.count || 0,
      sectionOverrides: overrides.count || 0,
    };
  }, args);
}

/**
 * Read a single column value from a single row by primary key. Use for
 * value-round-trip assertions where you need to confirm what you wrote
 * came back unchanged.
 */
export async function queryColumn(page, table, column, where) {
  return page.evaluate(
    async ({ t, c, w }) => {
      const sb = window._supabase;
      let q = sb.from(t).select(c);
      Object.entries(w).forEach(([k, v]) => {
        q = q.eq(k, v);
      });
      const res = await q.maybeSingle();
      if (res.error) throw new Error(`queryColumn ${t}.${c} failed: ` + res.error.message);
      return res.data ? res.data[c] : null;
    },
    { t: table, c: column, w: where },
  );
}

/**
 * Read a full row by filter clauses. Returns null if not found.
 */
export async function queryRow(page, table, columns, where) {
  return page.evaluate(
    async ({ t, c, w }) => {
      const sb = window._supabase;
      let q = sb.from(t).select(c);
      Object.entries(w).forEach(([k, v]) => {
        q = q.eq(k, v);
      });
      const res = await q.maybeSingle();
      if (res.error) throw new Error(`queryRow ${t} failed: ` + res.error.message);
      return res.data;
    },
    { t: table, c: columns, w: where },
  );
}

/**
 * Snapshot the in-flight write counter from window.GB.getSyncStatus().
 * Greater than 0 means at least one write is queued / in flight; the
 * production window.signOut should wait on this via waitForPendingSyncs.
 * Used by race tests to assert the queue is being tracked at all.
 */
export async function readPendingSyncs(page) {
  return page.evaluate(() => {
    if (window.GB && typeof window.GB.getSyncStatus === 'function') {
      const s = window.GB.getSyncStatus();
      return s ? s.pending : null;
    }
    return null;
  });
}
