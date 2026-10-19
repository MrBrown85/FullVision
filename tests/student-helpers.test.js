import './setup.js';

describe('StudentOverrides helpers', () => {
  beforeEach(() => {
    const panel = { id: 'override-panel-sec-1', style: { display: 'none' }, innerHTML: '' };
    globalThis.document.getElementById = id => (id === 'override-panel-sec-1' ? panel : null);
    globalThis.document.querySelectorAll = sel => (sel === '.override-panel' ? [panel] : []);
    globalThis._overridePanel = panel;
    globalThis.getSectionOverride = () => ({ level: 3, reason: 'Observed growth' });
    globalThis.getSectionProficiencyRaw = () => 2.8;
  });

  it('renders override panel content into the section placeholder', () => {
    let selected = 0;
    StudentOverrides.toggleOverridePanel({
      activeCourse: 'c1',
      studentId: 's1',
      secId: 'sec-1',
      setSelectedLevel: level => {
        selected = level;
      },
      getSelectedLevel: () => selected,
    });

    expect(selected).toBe(3);
    expect(globalThis._overridePanel.style.display).toBe('');
    expect(globalThis._overridePanel.innerHTML).toContain('Override Proficiency');
    expect(globalThis._overridePanel.innerHTML).toContain('Observed growth');
  });

  it('saves an override when a level and reason are present', () => {
    let saved = null;
    globalThis.document.getElementById = id => {
      if (id === 'override-reason-sec-1') return { value: 'Teacher judgment', style: {}, focus() {}, placeholder: '' };
      return globalThis._overridePanel;
    };
    globalThis.setSectionOverride = (cid, sid, secId, level, reason) => {
      saved = { cid, sid, secId, level, reason };
    };

    const result = StudentOverrides.saveOverride('c1', 's1', 'sec-1', 4);
    expect(result).toBe(true);
    expect(saved).toEqual({ cid: 'c1', sid: 's1', secId: 'sec-1', level: 4, reason: 'Teacher judgment' });
  });
});
