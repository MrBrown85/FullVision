/**
 * NameMatch (shared/name-match.js): which student a file is named for, in
 * Add Work for the Class (B3). Every 'one' below is a match a careful
 * teacher would call certain; anything doubtful is 'close' or 'many'.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const CLASS = [
  ['noor', 'Noor', 'Al-Rashid'],
  ['jas', 'Jas', 'Bains'],
  ['sam', 'Sam', 'Blackwood'],
  ['samir', 'Samir', 'Haddad'],
  ['avery', 'Avery', 'Chen'],
  ['liamc', 'Liam', 'Chen'],
  ['william', 'William', 'Ortiz'],
  ['mateo', 'Mateo', 'Cruz'],
  ['ines', 'Inès', 'Larsen'],
  ['teddy', 'Theodore', 'Okafor', 'Teddy'],
  ['priyak', 'Priya', 'Kaur'],
  ['priyas', 'Priya', 'Singh'],
  ['ruby', 'Ruby', 'Gill'],
  ['hana', 'Hana', 'Sato'],
  ['owen', 'Owen', "O'Brien"],
  ['marcus', 'Marcus', 'Osei'],
  ['annie', 'Anne-Marie', 'Tremblay'],
  ['dirk', 'Dirk', 'van der Berg'],
].map(([id, firstName, lastName, preferred]) => ({ id, firstName, lastName, preferred }));

const m = name => NameMatch.match(name, CLASS);

describe('certain: placed on the student', () => {
  it.each([
    // First and last, either order, any breaks and capitals.
    ['Owen OBrien.pdf', 'owen'],
    ['jas bains.jpg', 'jas'],
    ['Blackwood_Sam.pdf', 'sam'],
    ['GILL RUBY.pdf', 'ruby'],
    ['sato-hana.pdf', 'hana'],
    ['Kaur, Priya.pdf', 'priyak'],
    ['Singh Priya (2).jpg', 'priyas'],
    ['AveryChen.pdf', 'avery'],
    // A hyphenated or two-word last name, together or apart.
    ['Al-Rashid Noor.pdf', 'noor'],
    ['noor alrashid.pdf', 'noor'],
    ['Noor Al Rashid.pdf', 'noor'],
    ['dirk vanderberg.pdf', 'dirk'],
    ['Van Der Berg, Dirk.pdf', 'dirk'],
    ['anne marie tremblay.jpg', 'annie'],
    ['AnneMarie Tremblay.jpg', 'annie'],
    // An apostrophe joins.
    ["owen o'brien.jpg", 'owen'],
    // Accents don't matter, either way round.
    ['Ines Larsen.pdf', 'ines'],
    ['INÈS LARSEN.pdf', 'ines'],
    // A preferred name counts as a first name; the legal one still does.
    ['Teddy Okafor.pdf', 'teddy'],
    ['Okafor Theodore.pdf', 'teddy'],
    // Two students share a last name: the first name settles it.
    ['Liam Chen.pdf', 'liamc'],
    ['Chen Avery 2.pdf', 'avery'],
    // Two share a first name: the last name, or its initial, settles it.
    ['Priya K.pdf', 'priyak'],
    ['priya_s.jpg', 'priyas'],
    ['P. Kaur.pdf', 'priyak'],
    ['Liam C.jpg', 'liamc'],
    ['Chen A.pdf', 'avery'],
    // A name that is the start or end of another is still its own.
    ['Sam.pdf', 'sam'],
    ['Samir.pdf', 'samir'],
    ['William.pdf', 'william'],
    ['Liam.pdf', 'liamc'],
    // One name alone, held by one student only.
    ['Blackwood.pdf', 'sam'],
    ['osei.pdf', 'marcus'],
    ['Teddy.jpg', 'teddy'],
    // Folders, numbers and the words a scan adds are passed over.
    ['Scans/Period 2/Hana Sato.pdf', 'hana'],
    ['Avery Chen 10.jpg', 'avery'],
    ['Scan_Mateo_Cruz_page2.jpg', 'mateo'],
    ['IMG_0042 Ruby Gill final copy.jpg', 'ruby'],
    ['abbott_p3_Owen_OBrien.jpg', 'owen'],
    // Other words beside a full name don't matter.
    ['Priya Kaur - Conscription essay.pdf', 'priyak'],
  ])('%s → %s', (file, sid) => {
    expect(m(file)).toEqual({ kind: 'one', sid });
  });
});

describe('close: offered, never taken', () => {
  it.each([
    // A letter off; two for a long name.
    ['Matteo C.jpg', 'mateo', 'spelling'],
    ['Mateo Kruz.pdf', 'mateo', 'spelling'],
    ['Blakwood.pdf', 'sam', 'spelling'],
    ['Noor Al-Rasheed.pdf', 'noor', 'spelling'],
    ['Teodore.pdf', 'teddy', 'spelling'],
    // One name fits, another word doesn't.
    ['Sam Jones.pdf', 'sam', 'part'],
    ['Kowalski Ruby.pdf', 'ruby', 'part'],
    ['Sam J.pdf', 'sam', 'part'],
    ['Osei essay.pdf', 'marcus', 'part'],
    ['Priya K Smith.pdf', 'priyak', 'part'],
    // A full name with another student's name in it too.
    ['Hana Sato and Ruby.pdf', 'hana', 'other'],
  ])('%s → %s (%s)', (file, sid, why) => {
    expect(m(file)).toMatchObject({ kind: 'close', sid, why });
  });

  it('says which word did not fit', () => {
    expect(m('Sam Jones.pdf')).toEqual({ kind: 'close', sid: 'sam', why: 'part', word: 'Jones' });
  });
});

describe('many: two or more students fit', () => {
  it.each([
    ['Chen.pdf', ['avery', 'liamc'], 'Chen'],
    ['chen (1).jpg', ['avery', 'liamc'], 'Chen'],
    ['Priya.pdf', ['priyak', 'priyas'], 'Priya'],
    ['Priya P.pdf', ['priyak', 'priyas'], 'Priya'],
    ['Hana Sato Ruby Gill.pdf', ['ruby', 'hana'], undefined],
    ['Sam Chen.pdf', ['sam', 'avery', 'liamc'], undefined],
    ['Prya.pdf', ['priyak', 'priyas'], undefined],
  ])('%s → %j', (file, sids, word) => {
    const got = m(file);
    expect(got.kind).toBe('many');
    expect([...got.sids].sort()).toEqual([...sids].sort());
    expect(got.word).toBe(word);
  });
});

describe('none: nobody fits', () => {
  it.each([
    ['SCAN0017.pdf', 'no_name'],
    ['IMG_4471.jpg', 'no_name'],
    ['DSC_0012 copy.jpg', 'no_name'],
    ['page 3.pdf', 'no_name'],
    ['2026-11-17.pdf', 'no_name'],
    ['PK.pdf', 'unknown'],
    ['Conscription Crisis.pdf', 'unknown'],
    ['Zara Singhal.pdf', 'unknown'],
    ['Al.pdf', 'unknown'],
    ['', 'no_name'],
  ])('%s → none (%s)', (file, why) => {
    expect(m(file)).toEqual({ kind: 'none', why });
  });
});

describe('the class list', () => {
  it('two students with the same full name are never told apart', () => {
    const twins = [...CLASS, { id: 'avery2', firstName: 'Avery', lastName: 'Chen' }];
    expect(NameMatch.match('Avery Chen.pdf', twins)).toMatchObject({ kind: 'many', sids: ['avery', 'avery2'] });
  });

  it('a student who is not in the list is never matched', () => {
    const fewer = CLASS.filter(st => st.id !== 'liamc');
    expect(NameMatch.match('Chen.pdf', fewer)).toEqual({ kind: 'one', sid: 'avery' });
    expect(NameMatch.match('Chen.pdf', [])).toEqual({ kind: 'none', why: 'unknown' });
  });

  it('a student with no last name, or blank names, is read safely', () => {
    const odd = [{ id: 'x', firstName: 'Kai', lastName: '' }, { id: 'y', firstName: '', lastName: '' }, null];
    expect(NameMatch.match('Kai.pdf', odd)).toEqual({ kind: 'one', sid: 'x' });
  });
});

describe('natural order', () => {
  it('puts 2 before 10, and ignores capitals', () => {
    const files = ['Avery Chen 10.jpg', 'avery chen 2.jpg', 'Avery Chen 1.jpg', 'Avery Chen.jpg'];
    expect([...files].sort(NameMatch.compare)).toEqual([
      'Avery Chen 1.jpg',
      'avery chen 2.jpg',
      'Avery Chen 10.jpg',
      'Avery Chen.jpg',
    ]);
  });
});
