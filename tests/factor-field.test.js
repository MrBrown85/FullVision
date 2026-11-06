/**
 * The assessment form's Factor stepper and share bar (teacher/factor-field.js,
 * 2026-11-06). Any Factor from 0.1 to 10 to one decimal, typed or stepped by
 * 0.5; a stored Factor is kept exactly until it is changed. The bar shows
 * this assessment's share of its category in blue, the others grey.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

let doc;
function field(weight) {
  doc = parseHTML('<!DOCTYPE html><html><body><div id="m"></div></body></html>').document;
  doc.getElementById('m').innerHTML = FactorField.fieldHtml(weight);
  return doc.getElementById('af-weight');
}

describe('the Factor stepper', () => {
  it('steps by 0.5 and never below 0.1 or above 10', () => {
    expect(FactorField.step(1, 1)).toBe(1.5);
    expect(FactorField.step(2.3, -1)).toBe(1.8);
    expect(FactorField.step(0.5, -1)).toBe(0.1);
    expect(FactorField.step(0.1, -1)).toBe(0.1);
    expect(FactorField.step(0.1, 1)).toBe(0.6);
    expect(FactorField.step(9.8, 1)).toBe(10);
  });

  it('takes any typed value, to one decimal and clamped', () => {
    expect(FactorField.parse('2.3')).toBe(2.3);
    expect(FactorField.parse(' 0.7 ')).toBe(0.7);
    expect(FactorField.parse('2.34')).toBe(2.3);
    expect(FactorField.parse('0.04')).toBe(0.1);
    expect(FactorField.parse('25')).toBe(10);
    expect(FactorField.parse('')).toBe(null);
    expect(FactorField.parse('0')).toBe(null);
    expect(FactorField.parse('-2')).toBe(null);
    expect(FactorField.parse('abc')).toBe(null);
  });

  it('draws a number box between two named buttons', () => {
    const input = field(2.3);
    expect(input.getAttribute('type')).toBe('number');
    expect(input.getAttribute('min')).toBe('0.1');
    expect(input.getAttribute('max')).toBe('10');
    expect(input.getAttribute('step')).toBe('0.1');
    expect(input.value).toBe('2.3');
    const buttons = [...doc.querySelectorAll('.af-factor-btn')];
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['Lower the factor', 'Raise the factor']);
    expect(buttons.map(b => b.dataset.dir)).toEqual(['-1', '1']);
  });

  it('keeps a stored Factor exactly until it is changed', () => {
    const input = field(1.25);
    expect(FactorField.read(input)).toBe(1.25);
    input.value = '1.75';
    expect(FactorField.read(input)).toBe(1.8);
  });

  it('saves what was typed, to one decimal', () => {
    const input = field(1);
    input.value = '2.34';
    FactorField.track(input);
    expect(FactorField.read(input)).toBe(2.3);
    FactorField.settle(input);
    expect(input.value).toBe('2.3');
  });

  it('holds the last good value while the box is blank, and puts it back on leaving', () => {
    const input = field(1);
    input.value = '3.5';
    FactorField.track(input);
    input.value = '';
    FactorField.track(input);
    expect(FactorField.read(input)).toBe(3.5);
    FactorField.settle(input);
    expect(input.value).toBe('3.5');
  });

  it('steps the box and tells the form', () => {
    const input = field(2.3);
    const seen = [];
    input.addEventListener('input', () => seen.push('input'));
    input.addEventListener('change', () => seen.push('change'));
    FactorField.stepIn(input, 1);
    expect(input.value).toBe('2.8');
    expect(FactorField.read(input)).toBe(2.8);
    FactorField.stepIn(input, -1);
    FactorField.stepIn(input, -1);
    expect(input.value).toBe('1.8');
    expect(seen).toEqual(['input', 'change', 'input', 'change', 'input', 'change']);
  });

  it('sets a kept or copied Factor exactly', () => {
    const input = field(1);
    FactorField.set(input, 1.25);
    expect(input.value).toBe('1.25');
    expect(FactorField.read(input)).toBe(1.25);
  });
});

describe('the share bar', () => {
  let mount;
  beforeEach(() => {
    doc = parseHTML('<!DOCTYPE html><html><body><div id="af-counts-as"></div></body></html>').document;
    mount = doc.getElementById('af-counts-as');
  });

  const share = {
    kind: 'share',
    share: 115 / 165,
    category: 'Unit Tests',
    mode: 'points',
    parts: [
      { id: 'a1', title: 'Unit Test 1', share: 115 / 165, self: true },
      { id: 'a2', title: 'Unit Test 2 <b>', share: 50 / 165, self: false },
    ],
  };

  it('splits the category: this one blue, the others grey, each named with its share', () => {
    FactorField.renderBar(mount, share, 'Unit Test 1');
    const segs = [...mount.querySelectorAll('.af-share-seg')];
    expect(segs).toHaveLength(2);
    expect(segs[0].classList.contains('af-share-self')).toBe(true);
    expect(segs[1].classList.contains('af-share-self')).toBe(false);
    expect(segs.map(s => s.getAttribute('title'))).toEqual(['Unit Test 1: 70%', 'Unit Test 2 <b>: 30%']);
    expect(Number(segs[0].style.flexGrow || segs[0].getAttribute('style').match(/flex-grow:([\d.]+)/)[1])).toBeCloseTo(
      115 / 165,
      5,
    );
    expect(mount.querySelector('.af-share-pct').textContent).toBe('≈ 70% of');
    expect(mount.querySelector('.af-share-cat').textContent).toBe('Unit Tests');
    // Names are escaped.
    expect(mount.querySelector('b')).toBe(null);
  });

  it('names an untitled new assessment', () => {
    FactorField.renderBar(mount, share, '');
    expect(mount.querySelector('.af-share-self').getAttribute('title')).toBe('This assessment: 70%');
  });

  it('says the course % in a class with no categories', () => {
    FactorField.renderBar(mount, { ...share, category: null }, 'Quiz');
    expect(mount.querySelector('.af-share-cat').textContent).toBe('the course %');
  });

  it('keeps the short states, and shows nothing with no %', () => {
    FactorField.renderBar(mount, { kind: 'uncategorized' });
    expect(mount.textContent).toBe('Not in the course %');
    FactorField.renderBar(mount, { kind: 'zero', category: 'Practice' });
    expect(mount.textContent).toBe('Practice counts 0%');
    FactorField.renderBar(mount, null);
    expect(mount.innerHTML).toBe('');
  });
});
