/**
 * The curriculum importer (buildLearningMapFromTags) on the rebuilt bank:
 * Ministry headings become folders, each competency is named from its own
 * short_label, the order is the Ministry's, the bank id is kept, and a
 * combined class never shows the same folder name or code twice. The old
 * bank's shape imports as before. Curriculum bank stage 4, PR 3.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

function build(keys, options) {
  CURRICULUM_INDEX = newBankIndex(keys);
  return buildLearningMapFromTags(keys, options);
}

afterEach(() => {
  CURRICULUM_INDEX = null;
});

describe('one course: Drafting 10', () => {
  it('makes the eight Ministry folders and leaves Understanding Context out of them', () => {
    var map = build(['DRAFT10']);
    expect(map.competencyGroups.map(g => g.name)).toEqual([
      'Defining',
      'Ideating',
      'Prototyping',
      'Testing',
      'Making',
      'Sharing',
      'Applied Skills',
      'Applied Technologies',
    ]);
    expect(map.sections).toHaveLength(27);
    var uc1 = map.sections[0];
    expect(uc1.tags[0].code).toBe('UC1');
    expect(uc1.groupId).toBeUndefined();
  });

  it('names each competency from its own short_label, not its heading', () => {
    var map = build(['DRAFT10']);
    var pr3 = map.sections.find(s => s.tags[0].code === 'PR3');
    expect(pr3.name).toBe('Prototype Building');
    expect(pr3.tags[0].label).toBe('Prototype Building');
    expect(pr3.shortName).toBe('Prototype Building');
    expect(map.competencyGroups.find(g => g.id === pr3.groupId).name).toBe('Prototyping');
  });

  it('keeps Ministry order: UC1 first, then each folder in turn', () => {
    var map = build(['DRAFT10']);
    expect(map.sections.slice(0, 6).map(s => s.tags[0].code)).toEqual(['UC1', 'DF1', 'DF2', 'DF3', 'ID1', 'ID2']);
    expect(map.sections.map(s => s.displayOrder)).toEqual(map.sections.map((s, i) => i));
  });

  it('keeps the bank id and the exact wording', () => {
    var map = build(['DRAFT10']);
    var tag = map.sections.find(s => s.tags[0].code === 'PR3').tags[0];
    expect(tag.bank_id).toMatch(/^bc\.draft10\.cc\.\d+$/);
    expect(tag.text).toBe('Prototype, making changes to tools, materials, and procedures as needed');
    expect(tag.source_text).toBe(tag.text);
  });

  it('leaves out what the teacher unticked', () => {
    var all = build(['DRAFT10']);
    var df3 = all.sections.find(s => s.tags[0].code === 'DF3').tags[0].bank_id;
    var map = build(['DRAFT10'], { skip: [df3] });
    expect(map.sections).toHaveLength(26);
    expect(map.sections.some(s => s.tags[0].code === 'DF3')).toBe(false);
  });

  it('makes no empty folder when every competency in it is unticked', () => {
    var all = build(['DRAFT10']);
    var testing = all.sections.filter(s => /^TS/.test(s.tags[0].code)).map(s => s.tags[0].bank_id);
    var map = build(['DRAFT10'], { skip: testing });
    expect(map.competencyGroups.map(g => g.name)).not.toContain('Testing');
  });

  it('starts with Folders Count as One on', () => {
    CURRICULUM_INDEX = newBankIndex(['DRAFT10']);
    expect(curriculumGradingDefaults(['DRAFT10'])).toEqual({ foldersCountAsOne: true, coursesCountEqually: false });
  });
});

describe('combined: Humanities 8 (ELA 8 + SS 8)', () => {
  it('gives ELA its two folders and leaves the eight SS competencies out of folders', () => {
    var map = build(['ELA8', 'SS8']);
    expect(map.competencyGroups.map(g => g.name)).toEqual(['Comprehend and Connect', 'Create and Communicate']);
    var ss = map.sections.filter(s => s.subject === 'SS8');
    expect(ss).toHaveLength(8);
    expect(ss.every(s => !s.groupId)).toBe(true);
    expect(ss.map(s => s.name)).toContain('Ethical Judgment');
  });

  it('changes no code, since the two courses share none', () => {
    var map = build(['ELA8', 'SS8']);
    expect(map.sections.find(s => s.subject === 'SS8').tags[0].code).toBe('INQ');
    expect(map.sections.find(s => s.subject === 'ELA8').tags[0].code).toBe('CP1');
  });

  it('starts with each course counted equally and folders not counted as one', () => {
    CURRICULUM_INDEX = newBankIndex(['ELA8', 'SS8']);
    expect(curriculumGradingDefaults(['ELA8', 'SS8'])).toEqual({ foldersCountAsOne: false, coursesCountEqually: true });
  });
});

describe('combined: courses that share folder names and codes', () => {
  it('prefixes a folder name both courses use with the course name', () => {
    var map = build(['COMP10', 'LS10']);
    var names = map.competencyGroups.map(g => g.name);
    expect(names).toContain('Composition 10: Comprehend and Connect');
    expect(names).toContain('Literary Studies 10: Comprehend and Connect');
    expect(names).not.toContain('Comprehend and Connect');
  });

  it('marks a code both courses use, so no two columns read the same', () => {
    var map = build(['COMP10', 'LS10']);
    var codes = map.sections.map(s => s.tags[0].code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('CCP1');
    expect(codes).toContain('LCP1');
    expect(codes.every(c => c.length <= 6)).toBe(true);
  });

  it('uses enough letters to tell courses apart', () => {
    var map = build(['COMP10', 'CW10']);
    var codes = map.sections.map(s => s.tags[0].code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain('COCP1');
    expect(codes).toContain('CWCP1');
  });

  it('never repeats a code across any same-grade, same-subject pair of courses', () => {
    var all = JSON.parse(
      require('fs').readFileSync(require('path').resolve(__dirname, '../data/bc-curriculum-source.json'), 'utf-8'),
    );
    var keys = Object.keys(all).filter(k => k[0] !== '_');
    var bad = [];
    var long = [];
    keys.forEach((a, i) => {
      keys.slice(i + 1).forEach(b => {
        if (all[a].grade !== all[b].grade || all[a].subject !== all[b].subject) return;
        var map = build([a, b]);
        var codes = map.sections.map(s => s.tags[0].code);
        if (new Set(codes).size !== codes.length) bad.push(a + '+' + b);
        if (codes.some(c => c.length > 6)) long.push(a + '+' + b);
      });
    });
    expect(bad).toEqual([]);
    expect(long).toEqual([]);
  }, 60000);
});

describe('the old bank', () => {
  var OLD = {
    SCI8: {
      course_name: 'Science 8',
      subject: 'Science',
      categories: [
        {
          name: 'Questioning and predicting',
          competencies: [
            { id: 'cc_sci8_qp_1', tag: 'QAP', short_label: 'Questioning', raw: 'Demonstrate curiosity' },
            { id: 'cc_sci8_qp_2', tag: 'PI', short_label: 'Planning', raw: 'Plan an investigation' },
          ],
        },
      ],
    },
  };

  it('imports as before: no folders, the heading as the name, no bank id', () => {
    CURRICULUM_INDEX = OLD;
    var map = buildLearningMapFromTags(['SCI8']);
    expect(map.competencyGroups).toEqual([]);
    expect(map.sections.map(s => s.name)).toEqual(['Questioning and predicting', 'Questioning and predicting']);
    expect(map.sections[0].shortName).toBe('Questioning');
    expect(map.sections[0].tags[0].label).toBe('Questioning');
    expect(map.sections[0].tags[0].bank_id).toBeNull();
  });
});
