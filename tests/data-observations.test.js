/**
 * Observation function tests — gb-data.js
 * Tests CRUD and filtering for quick observations.
 */

const CID = 'test';

beforeEach(() => {
  // Clear observation cache and localStorage
  _cache.observations[CID] = undefined;
  localStorage.clear();
});

describe('getStudentQuickObs', () => {
  it('returns observations sorted by created descending', () => {
    saveQuickObs(CID, {
      stu1: [
        { id: 'ob1', text: 'first', created: '2025-01-01T10:00:00Z' },
        { id: 'ob2', text: 'second', created: '2025-03-01T10:00:00Z' },
        { id: 'ob3', text: 'third', created: '2025-02-01T10:00:00Z' },
      ],
    });
    const result = getStudentQuickObs(CID, 'stu1');
    expect(result[0].id).toBe('ob2');
    expect(result[1].id).toBe('ob3');
    expect(result[2].id).toBe('ob1');
  });

  it('returns empty array for missing student', () => {
    saveQuickObs(CID, {});
    expect(getStudentQuickObs(CID, 'nobody')).toEqual([]);
  });

  it('returns empty array for course with no observations', () => {
    expect(getStudentQuickObs(CID, 'stu1')).toEqual([]);
  });
});

describe('getAllQuickObs', () => {
  it('flattens all students observations with studentId', () => {
    saveQuickObs(CID, {
      stu1: [{ id: 'ob1', text: 'a', created: '2025-01-01T10:00:00Z' }],
      stu2: [{ id: 'ob2', text: 'b', created: '2025-02-01T10:00:00Z' }],
    });
    const result = getAllQuickObs(CID);
    expect(result).toHaveLength(2);
    expect(result[0].studentId).toBe('stu2'); // more recent first
    expect(result[1].studentId).toBe('stu1');
  });

  it('sorts by created descending across students', () => {
    saveQuickObs(CID, {
      stu1: [{ id: 'ob1', text: 'old', created: '2025-01-01T10:00:00Z' }],
      stu2: [{ id: 'ob2', text: 'new', created: '2025-03-01T10:00:00Z' }],
    });
    const result = getAllQuickObs(CID);
    expect(result[0].text).toBe('new');
  });

  it('returns empty array for empty observations', () => {
    saveQuickObs(CID, {});
    expect(getAllQuickObs(CID)).toEqual([]);
  });
});

describe('addQuickOb', () => {
  it('adds observation with generated id and trimmed text', () => {
    saveQuickObs(CID, {});
    addQuickOb(CID, 'stu1', '  Good work  ', ['engagement'], 'strength', 'whole-class');
    const obs = getStudentQuickObs(CID, 'stu1');
    expect(obs).toHaveLength(1);
    expect(obs[0].text).toBe('Good work');
    expect(obs[0].id).toMatch(/^qo_/);
    expect(obs[0].dims).toEqual(['engagement']);
    expect(obs[0].sentiment).toBe('strength');
    expect(obs[0].context).toBe('whole-class');
  });

  it('stores assignmentContext when provided', () => {
    saveQuickObs(CID, {});
    addQuickOb(CID, 'stu1', 'Feedback', [], null, null, { assessmentId: 'a1' });
    const obs = getStudentQuickObs(CID, 'stu1');
    expect(obs[0].assignmentContext).toEqual({ assessmentId: 'a1' });
  });

  it('omits optional fields when not provided', () => {
    saveQuickObs(CID, {});
    addQuickOb(CID, 'stu1', 'Note', []);
    const obs = getStudentQuickObs(CID, 'stu1');
    expect(obs[0].sentiment).toBeUndefined();
    expect(obs[0].context).toBeUndefined();
    expect(obs[0].assignmentContext).toBeUndefined();
  });

  it('creates student key for first observation', () => {
    saveQuickObs(CID, {});
    addQuickOb(CID, 'newStudent', 'First note', []);
    expect(getStudentQuickObs(CID, 'newStudent')).toHaveLength(1);
  });
});

describe('deleteQuickOb', () => {
  it('removes observation by id', () => {
    saveQuickObs(CID, {
      stu1: [
        { id: 'ob1', text: 'keep' },
        { id: 'ob2', text: 'delete' },
      ],
    });
    deleteQuickOb(CID, 'stu1', 'ob2');
    const obs = getStudentQuickObs(CID, 'stu1');
    expect(obs).toHaveLength(1);
    expect(obs[0].id).toBe('ob1');
  });

  it('no-op if student has no observations', () => {
    saveQuickObs(CID, {});
    deleteQuickOb(CID, 'nobody', 'ob1'); // should not throw
  });
});

describe('getQuickObsByDim', () => {
  it('filters by dimension', () => {
    saveQuickObs(CID, {
      stu1: [
        { id: 'ob1', text: 'a', dims: ['engagement', 'curiosity'], created: '2025-01-01T00:00:00Z' },
        { id: 'ob2', text: 'b', dims: ['collaboration'], created: '2025-01-02T00:00:00Z' },
      ],
    });
    const result = getQuickObsByDim(CID, 'stu1', 'engagement');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ob1');
  });

  it('returns empty for non-matching dimension', () => {
    saveQuickObs(CID, {
      stu1: [{ id: 'ob1', dims: ['engagement'], created: '2025-01-01T00:00:00Z' }],
    });
    expect(getQuickObsByDim(CID, 'stu1', 'resilience')).toEqual([]);
  });
});

describe('getAssignmentObs', () => {
  it('filters by assignment context', () => {
    saveQuickObs(CID, {
      stu1: [
        { id: 'ob1', text: 'feedback', assignmentContext: { assessmentId: 'a1' }, created: '2025-01-01T00:00:00Z' },
        { id: 'ob2', text: 'general', created: '2025-01-02T00:00:00Z' },
      ],
    });
    expect(getAssignmentObs(CID, 'stu1', 'a1')).toHaveLength(1);
    expect(getAssignmentObs(CID, 'stu1', 'a2')).toHaveLength(0);
  });
});

describe('hasAssignmentFeedback', () => {
  it('returns true when feedback exists', () => {
    saveQuickObs(CID, {
      stu1: [{ id: 'ob1', assignmentContext: { assessmentId: 'a1' }, created: '2025-01-01T00:00:00Z' }],
    });
    expect(hasAssignmentFeedback(CID, 'stu1', 'a1')).toBe(true);
  });

  it('returns false when no feedback exists', () => {
    saveQuickObs(CID, { stu1: [{ id: 'ob1', text: 'general', created: '2025-01-01T00:00:00Z' }] });
    expect(hasAssignmentFeedback(CID, 'stu1', 'a1')).toBe(false);
  });
});

describe('loading observations from the server', () => {
  const AID = '55555555-5555-5555-5555-555555555555';

  afterEach(() => {
    delete _cache.assessments[CID];
  });

  it('restores the tags on each observation row', () => {
    const blob = _observationsPayloadToBlob({
      observations: [
        {
          id: 'ob1',
          body: 'Helped a partner',
          enrollment_ids: ['stu1', 'stu2'],
          dims: ['collaboration', 'cc:5', 'tag:Lab safety'],
          created_at: '2026-10-18T10:00:00Z',
        },
      ],
    });
    expect(blob.stu1[0].dims).toEqual(['collaboration', 'cc:5', 'tag:Lab safety']);
    expect(blob.stu2[0].dims).toEqual(['collaboration', 'cc:5', 'tag:Lab safety']);
  });

  it('gives an empty tag list to rows saved before tags were stored', () => {
    const blob = _observationsPayloadToBlob({
      observations: [{ id: 'ob1', body: 'x', enrollment_ids: ['stu1'], created_at: '2026-10-18T10:00:00Z' }],
    });
    expect(blob.stu1[0].dims).toEqual([]);
  });

  it('fills in the assessment title from the course assessments', () => {
    _cache.assessments[CID] = [{ id: AID, title: 'Cell model' }];
    const blob = _observationsPayloadToBlob(
      {
        observations: [
          { id: 'ob1', body: 'x', assessment_id: AID, enrollment_ids: ['stu1'], created_at: '2026-10-18T10:00:00Z' },
        ],
      },
      CID,
    );
    expect(blob.stu1[0].assignmentContext).toEqual({ assessmentId: AID, assessmentTitle: 'Cell model' });
  });

  it('leaves the title empty when the assessment is not in the course', () => {
    _cache.assessments[CID] = [];
    const blob = _observationsPayloadToBlob(
      {
        observations: [
          { id: 'ob1', body: 'x', assessment_id: AID, enrollment_ids: ['stu1'], created_at: '2026-10-18T10:00:00Z' },
        ],
      },
      CID,
    );
    expect(blob.stu1[0].assignmentContext).toEqual({ assessmentId: AID, assessmentTitle: '' });
  });

  it('the bundle load restores tags and the assessment title', () => {
    _bundleToCache(CID, {
      gradebook: {
        course: { id: CID },
        students: [],
        assessments: [{ id: AID, title: 'Cell model', score_mode: 'proficiency' }],
        categories: [],
        modules: [],
      },
      observations: {
        observations: [
          {
            id: 'ob1',
            body: 'Careful drawing',
            assessment_id: AID,
            enrollment_ids: ['stu1'],
            dims: ['engagement'],
            created_at: '2026-10-18T10:00:00Z',
          },
        ],
        total: 1,
      },
    });
    const ob = getStudentQuickObs(CID, 'stu1')[0];
    expect(ob.dims).toEqual(['engagement']);
    expect(ob.assignmentContext.assessmentTitle).toBe('Cell model');
  });
});
