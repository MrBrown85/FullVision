/**
 * Demo-seed generator tests — shared/demo-seed.js (Phase 5.1)
 *
 * Covers:
 *   window.buildDemoSeedPayload — shape + counts per DECISIONS.md Q43
 *   window.applyDemoSeed        — dispatches to window.v2.importJsonRestore
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/demo-seed.js'), 'utf-8'), {
  filename: 'shared/demo-seed.js',
});

const COURSE_ID = '11111111-1111-1111-1111-111111111111';

describe('buildDemoSeedPayload', () => {
  var payload;

  beforeEach(() => {
    payload = window.buildDemoSeedPayload({ courseId: COURSE_ID });
  });

  it('returns a top-level object with the expected section keys', () => {
    expect(Object.keys(payload).sort()).toEqual(
      expect.arrayContaining([
        'subjects',
        'sections',
        'tags',
        'modules',
        'categories',
        'rubrics',
        'criteria',
        'criterion_tags',
        'students',
        'enrollments',
        'assessments',
        'assessment_tags',
        'scores',
        'rubric_scores',
        'tag_scores',
        'notes',
        'goals',
        'reflections',
        'report_configs',
      ]),
    );
  });

  it('generates the Q43-spec counts (4 subjects / 7 sections / 14 tags / 4 modules / 3 categories / 1 rubric with 4 criteria / 25 students / 8 assessments)', () => {
    expect(payload.subjects).toHaveLength(4);
    expect(payload.sections).toHaveLength(7);
    expect(payload.tags).toHaveLength(14);
    expect(payload.modules).toHaveLength(4);
    expect(payload.categories).toHaveLength(3);
    expect(payload.rubrics).toHaveLength(1);
    expect(payload.criteria).toHaveLength(4);
    expect(payload.students).toHaveLength(25);
    expect(payload.enrollments).toHaveLength(25);
    expect(payload.assessments).toHaveLength(8);
  });

  it('scopes all course-owned rows to the provided courseId', () => {
    payload.subjects.forEach(function (s) {
      expect(s.course_id).toBe(COURSE_ID);
    });
    payload.sections.forEach(function (s) {
      expect(s.course_id).toBe(COURSE_ID);
    });
    payload.modules.forEach(function (m) {
      expect(m.course_id).toBe(COURSE_ID);
    });
    payload.categories.forEach(function (c) {
      expect(c.course_id).toBe(COURSE_ID);
    });
    payload.enrollments.forEach(function (e) {
      expect(e.course_id).toBe(COURSE_ID);
    });
    payload.assessments.forEach(function (a) {
      expect(a.course_id).toBe(COURSE_ID);
    });
  });

  it('generates UUIDs for every entity id', () => {
    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    [
      'subjects',
      'sections',
      'tags',
      'modules',
      'rubrics',
      'criteria',
      'students',
      'enrollments',
      'assessments',
    ].forEach(function (k) {
      payload[k].forEach(function (row) {
        expect(row.id).toMatch(UUID_RE);
      });
    });
    payload.categories.forEach(function (row) {
      expect(row.id).toMatch(UUID_RE);
    });
  });

  it('links enrollments to students via FK', () => {
    var studentIds = new Set(
      payload.students.map(function (s) {
        return s.id;
      }),
    );
    payload.enrollments.forEach(function (e) {
      expect(studentIds.has(e.student_id)).toBe(true);
    });
  });

  it('links criterion_tags to valid criteria + tags', () => {
    var critIds = new Set(
      payload.criteria.map(function (c) {
        return c.id;
      }),
    );
    var tagIds = new Set(
      payload.tags.map(function (t) {
        return t.id;
      }),
    );
    payload.criterion_tags.forEach(function (ct) {
      expect(critIds.has(ct.criterion_id)).toBe(true);
      expect(tagIds.has(ct.tag_id)).toBe(true);
    });
  });

  it('generates a non-empty scores distribution', () => {
    expect(payload.scores.length).toBeGreaterThan(0);
    // Every score must reference a valid enrollment + assessment.
    var enrIds = new Set(
      payload.enrollments.map(function (e) {
        return e.id;
      }),
    );
    var assIds = new Set(
      payload.assessments.map(function (a) {
        return a.id;
      }),
    );
    payload.scores.forEach(function (s) {
      expect(enrIds.has(s.enrollment_id)).toBe(true);
      expect(assIds.has(s.assessment_id)).toBe(true);
    });
  });

  it('emits category-first assessments with real evidence types', () => {
    var categoryIds = new Set(
      payload.categories.map(function (c) {
        return c.id;
      }),
    );
    payload.assessments.forEach(function (assessment) {
      expect(categoryIds.has(assessment.category_id)).toBe(true);
      expect(assessment.evidence_type).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(assessment, 'type')).toBe(false);
    });
  });

  it('generates a default courseId when none is supplied', () => {
    var pl = window.buildDemoSeedPayload();
    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(pl.subjects[0].course_id).toMatch(UUID_RE);
  });
});

describe('applyDemoSeed', () => {
  var originalImport;
  var captured;

  beforeEach(() => {
    window.v2 = window.v2 || {};
    originalImport = window.v2.importJsonRestore;
    captured = null;
    window.v2.importJsonRestore = function (p) {
      captured = p;
      return Promise.resolve({ data: 'ok', error: null });
    };
  });

  afterEach(() => {
    window.v2.importJsonRestore = originalImport;
  });

  it('dispatches buildDemoSeedPayload(courseId) to window.v2.importJsonRestore', async () => {
    await window.applyDemoSeed(COURSE_ID);
    expect(captured).not.toBeNull();
    expect(captured.subjects).toHaveLength(4);
    expect(captured.subjects[0].course_id).toBe(COURSE_ID);
  });

  it('includes categories in the dispatched payload', async () => {
    await window.applyDemoSeed(COURSE_ID);
    expect(captured.categories).toHaveLength(3);
    captured.categories.forEach(function (c) {
      expect(c.course_id).toBe(COURSE_ID);
      expect(typeof c.weight).toBe('number');
    });
  });

  it('refuses when courseId is missing', async () => {
    var warnings = [];
    var origWarn = console.warn;
    console.warn = function (m) {
      warnings.push(m);
    };
    await window.applyDemoSeed();
    console.warn = origWarn;
    expect(captured).toBeNull();
    expect(warnings.join(' ')).toMatch(/courseId/);
  });
});
