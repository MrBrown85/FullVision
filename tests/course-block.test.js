/**
 * Class blocks (migrations/20261020_course_block.sql): each class can name its
 * block so two sections of a course read differently in every class picker.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

describe('course blocks', () => {
  it('upper-cases short codes and keeps longer labels as typed', () => {
    expect(normalizeCourseBlock(' a ')).toBe('A');
    expect(normalizeCourseBlock('x')).toBe('X');
    expect(normalizeCourseBlock('2')).toBe('2');
    expect(normalizeCourseBlock('Lunch club')).toBe('Lunch club');
    expect(normalizeCourseBlock(null)).toBe('');
    expect(normalizeCourseBlock('x'.repeat(40))).toHaveLength(24);
  });

  it('labels a code as "Block A" and shows it before the class name', () => {
    expect(courseBlockLabel({ block: 'c' })).toBe('Block C');
    expect(courseBlockLabel({ block: 'Jazz band' })).toBe('Jazz band');
    expect(courseBlockLabel({})).toBe('');
    expect(courseDisplayName({ name: 'Philosophy 12', block: 'A' })).toBe('Block A \u00B7 Philosophy 12');
    expect(courseDisplayName({ name: 'Philosophy 12' })).toBe('Philosophy 12');
  });

  it('does not repeat a block the name already carries', () => {
    expect(courseDisplayName({ name: 'Philosophy 12 - Block A', block: 'A' })).toBe('Philosophy 12 - Block A');
  });

  it('sorts lettered blocks first, then labels, then classes with no block', () => {
    const list = [
      { id: 'none', name: 'Homeroom' },
      { id: 'x', name: 'Jazz', block: 'X' },
      { id: 'club', name: 'Chess', block: 'Lunch club' },
      { id: 'b', name: 'Philosophy 12', block: 'B' },
      { id: 'a', name: 'Philosophy 12', block: 'A' },
      { id: 'd', name: 'English 10', block: 'D' },
    ];
    expect(sortCoursesByBlock(list).map(c => c.id)).toEqual(['a', 'b', 'd', 'x', 'club', 'none']);
  });

  it('class pickers list classes in block order with the block shown', () => {
    saveCourses({
      c1: { id: 'c1', name: 'English 10', block: 'D' },
      c2: { id: 'c2', name: 'Philosophy 12', block: 'B' },
      c3: { id: 'c3', name: 'Philosophy 12', block: 'A' },
    });
    expect(getPickerCourses('c1').map(c => c.name)).toEqual([
      'Block A \u00B7 Philosophy 12',
      'Block B \u00B7 Philosophy 12',
      'Block D \u00B7 English 10',
    ]);
  });
});
