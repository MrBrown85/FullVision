/**
 * Test data factories. Keep test bodies focused on the *intent* of the
 * test (what we're persisting) rather than the data shape (what fields
 * the schema demands). Every factory returns a fully-formed object that
 * passes through the matching production write helper without further
 * massaging.
 */

let _seq = 0;
function uid(prefix) {
  _seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${_seq}`;
}

export function makeStudent(overrides = {}) {
  const first = overrides.firstName || 'Probe';
  const last = overrides.lastName || 'Student';
  return {
    id: uid('stu'),
    firstName: first,
    lastName: last,
    preferred: '',
    pronouns: '',
    studentNumber: '',
    email: '',
    dateOfBirth: '',
    designations: [],
    attendance: [],
    sortName: `${last} ${first}`,
    enrolledDate: new Date().toISOString().slice(0, 10),
    ...overrides,
  };
}

export function makeAssessment(overrides = {}) {
  return {
    id: uid('asmt'),
    title: 'Probe Assignment',
    date: new Date().toISOString().slice(0, 10),
    type: 'summative',
    categoryId: null,
    tagIds: [],
    scoreMode: 'proficiency',
    maxPoints: null,
    weight: 1.0,
    ...overrides,
  };
}

export function makeCategory(overrides = {}) {
  return {
    id: null, // server-minted on insert
    name: 'Probe Category',
    weight: 50,
    displayOrder: 0,
    ...overrides,
  };
}

export function makeRubric(overrides = {}) {
  return {
    id: uid('rub'),
    title: 'Probe Rubric',
    description: '',
    criteria: [
      { id: uid('crit'), label: 'Accuracy', weight: 1, levels: 4 },
      { id: uid('crit'), label: 'Clarity', weight: 1, levels: 4 },
    ],
    ...overrides,
  };
}

export function makeModule(overrides = {}) {
  return {
    id: uid('mod'),
    name: 'Probe Module',
    color: '#0891b2',
    sortOrder: 0,
    ...overrides,
  };
}

export function makeCustomTag(overrides = {}) {
  return {
    label: 'Probe Tag',
    ...overrides,
  };
}

/**
 * Stable observation payload for the rich create_observation RPC.
 */
export function makeObservation(overrides = {}) {
  return {
    body: 'Probe observation body — student showed initiative.',
    sentiment: null,
    contextType: null,
    enrollmentIds: [],
    tagIds: [],
    customTagIds: [],
    ...overrides,
  };
}
