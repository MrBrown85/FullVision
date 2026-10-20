import './setup.js';

describe('DashOverview.renderDashToolbar', () => {
  beforeEach(() => {
    Object.keys(COURSES).forEach(key => delete COURSES[key]);
    COURSES.c1 = { name: 'Alpha' };
    COURSES.c2 = { name: 'Archived', archived: true };
    globalThis.isCourseArchived = cid => !!(COURSES[cid] && COURSES[cid].archived);
  });

  it('renders only non-archived course options and current state', () => {
    const html = DashOverview.renderDashToolbar({
      activeCourse: 'c1',
      sortMode: 'overall-desc',
      searchQuery: 'noor',
      showFlaggedOnly: true,
      students: [{ id: 's1' }, { id: 's2' }],
      flagCount: 3,
    });

    expect(html).toContain('Alpha');
    expect(html).not.toContain('Archived');
    expect(html).toContain('value="overall-desc" selected');
    expect(html).toContain('value="noor"');
    expect(html).toContain('Flagged (3)');
    expect(html).toContain('2 Students');
  });
});

describe('DashStudentCards.renderStudentCards', () => {
  beforeEach(() => {
    globalThis.isStudentFlagged = () => false;
    globalThis.getOverallProficiency = () => 0;
    globalThis.getCompletionPct = () => 0;
    globalThis.getStudentQuickObs = () => [];
    globalThis.getGroupedSections = () => ({ groups: [], ungrouped: [] });
    globalThis.getSectionProficiency = () => 0;
  });

  it('renders empty state when no students exist', () => {
    const html = DashStudentCards.renderStudentCards('c1', [], [], [], [], {}, {});
    expect(html).toContain('No students yet');
  });

  it('renders no matches state when filtered list is empty', () => {
    const html = DashStudentCards.renderStudentCards('c1', [], [{ id: 's1' }], [], [], {}, {});
    expect(html).toContain('No matches');
  });
});
