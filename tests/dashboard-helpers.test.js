import './setup.js';

describe('DashOverview.renderDashToolbar', () => {
  beforeEach(() => {
    Object.keys(COURSES).forEach(key => delete COURSES[key]);
    COURSES.c1 = { name: 'Alpha' };
    COURSES.c2 = { name: 'Archived', archived: true };
    globalThis.isCourseArchived = cid => !!(COURSES[cid] && COURSES[cid].archived);
  });

  it('renders only non-archived course options and the count', () => {
    const html = DashOverview.renderDashToolbar({
      activeCourse: 'c1',
      students: [{ id: 's1' }, { id: 's2' }],
    });

    expect(html).toContain('Alpha');
    expect(html).not.toContain('Archived');
    expect(html).toContain('2 Students');
    expect(html).not.toContain('dash-search-input');
  });

  it('puts search, sort and Flagged in the Students heading with their state', () => {
    const html = DashOverview.studentControlsHtml({
      sortMode: 'overall-desc',
      searchQuery: 'noor',
      showFlaggedOnly: true,
      flagCount: 3,
    });

    expect(html).toContain('value="overall-desc" selected');
    expect(html).toContain('value="noor"');
    expect(html).toContain('Flagged (3)');
  });

  it('shows a grid column sort as the selected line of the sort menu', () => {
    const html = DashOverview.studentControlsHtml({
      sortMode: 'col:s:QAP:desc',
      extraSort: { value: 'col:s:QAP:desc', label: 'Questioning High\u2192Low' },
      searchQuery: '',
      showFlaggedOnly: false,
      flagCount: 0,
    });
    expect(html).toContain('<option value="col:s:QAP:desc" selected>Questioning High\u2192Low</option>');
  });
});

describe('DashInsights.gridSortOf', () => {
  it('reads the column and direction from the sort mode', () => {
    expect(DashInsights.gridSortOf('last-asc')).toEqual({ key: 'name', dir: 'asc' });
    expect(DashInsights.gridSortOf('overall-desc')).toEqual({ key: 'overall', dir: 'desc' });
    expect(DashInsights.gridSortOf('col:s:QAP:asc')).toEqual({ key: 'col:s:QAP', dir: 'asc' });
    expect(DashInsights.gridSortOf('obs:desc')).toEqual({ key: 'obs', dir: 'desc' });
    expect(DashInsights.gridSortOf('flagged')).toBeNull();
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
