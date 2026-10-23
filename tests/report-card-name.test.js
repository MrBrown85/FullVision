/**
 * The name at the top of a report card (the Letterhead block) and a printed
 * rubric: the preferred name or the first name, always with the last name
 * (printedStudentName in shared/data.js).
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const NORA = { id: 'st-nora', firstName: 'Eleanor', preferred: 'Nora', lastName: 'Kim' };

describe('printed student name', () => {
  it('is the preferred name, or the first name, then the last name', () => {
    expect(printedStudentName(NORA, 'preferred')).toBe('Nora Kim');
    expect(printedStudentName(NORA, 'first')).toBe('Eleanor Kim');
    expect(printedStudentName(NORA)).toBe('Nora Kim');
  });

  it('falls back to the first name when there is no preferred name', () => {
    expect(printedStudentName({ firstName: 'Alan', lastName: 'Turing' }, 'preferred')).toBe('Alan Turing');
  });
});

describe('report card Letterhead', () => {
  it('offers Preferred Name or First Name, Preferred by default', () => {
    const opt = ReportSheets.BLOCKS.header.options.find(o => o.key === 'name');
    expect(opt.def).toBe('preferred');
    expect(opt.choices.map(c => c.v)).toEqual(['preferred', 'first']);
  });

  it('prints the chosen name with the last name', () => {
    COURSES['c-name'] = { id: 'c-name', name: 'Science 8' };
    const head = style => ReportBlocks.renderBlockHeader('c-name', NORA, { termLabel: 'Term 1' }, { name: style });
    expect(head('preferred')).toContain('<div class="report-student-name">Nora Kim</div>');
    expect(head('first')).toContain('<div class="report-student-name">Eleanor Kim</div>');
    delete COURSES['c-name'];
  });
});
