import './setup.js';

describe('StudentNotes helpers', () => {
  beforeEach(() => {
    const notesList = { innerHTML: '' };
    const noteInput = { value: '', focus() {} };
    globalThis.document.getElementById = id => {
      if (id === 'notes-list') return notesList;
      if (id === 'note-input') return noteInput;
      return {
        innerHTML: '',
        style: {},
        classList: {
          add() {},
          remove() {},
          toggle() {},
          contains() {
            return false;
          },
        },
      };
    };
    globalThis.document.querySelectorAll = () => [];
    globalThis._notesList = notesList;
    globalThis._noteInput = noteInput;
  });

  it('renders the empty notes state', () => {
    globalThis.getStudentQuickObs = () => [];
    StudentNotes.renderNotes('c1', 's1');
    expect(globalThis._notesList.innerHTML).toContain('No notes or observations yet');
  });

  it('the note box is the capture strip with the student fixed, and Add rerenders the list', async () => {
    const { parseHTML } = await import('linkedom');
    const dom = parseHTML(
      '<!doctype html><html><body><div id="note-capture"></div><div id="notes-list"></div></body></html>',
    );
    const saved = {};
    ['document', 'getStudents', 'addQuickOb', 'getStudentQuickObs'].forEach(k => (saved[k] = globalThis[k]));
    let added = null;
    let rendered = 0;
    globalThis.document = dom.document;
    globalThis.getStudents = () => [{ id: 's1', firstName: 'Mei', lastName: 'Wong' }];
    globalThis.getStudentQuickObs = () => {
      rendered++;
      return [];
    };
    globalThis.addQuickOb = (cid, sid, text, dims, sentiment) => {
      added = { cid, sid, text, sentiment };
      return true;
    };
    try {
      const cap = StudentNotes.mountCapture('c1', 's1', dom.document.getElementById('note-capture'));
      const box = dom.document.getElementById('note-capture');
      expect(box.querySelector('#note-capture-input')).toBeTruthy();
      expect(box.querySelector('#note-student-btn')).toBeNull();
      expect(box.textContent).toContain('Mei Wong');
      cap.setText('Check in with student');
      cap.submit();
      expect(added).toEqual({ cid: 'c1', sid: 's1', text: 'Check in with student', sentiment: null });
      expect(rendered).toBeGreaterThan(0);
      expect(cap.getText()).toBe('');
      StudentNotes.destroyCapture();
    } finally {
      Object.keys(saved).forEach(k => (globalThis[k] = saved[k]));
    }
  });
});

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
