/**
 * A teacher's saved Customize Card config, read back (getCardWidgetConfigFromRaw,
 * shared/data.js). A save names every widget there was at the time; a widget
 * added since (the To Grade widget, PR 1058, on by default) must show for a
 * teacher who saved before it existed, at its place in the registry, and a
 * widget the teacher turned off stays off.
 */
import './setup-mobile.js';
import { describe, expect, it } from 'vitest';

const ALL = WIDGET_REGISTRY.map(w => w.key);
const without = (list, ...keys) => list.filter(k => !keys.includes(k));

// A config as saved by a teacher before the To Grade widget existed.
function savedBefore(order, disabled) {
  return { order: without(order, 'toGrade'), disabled: without(disabled, 'toGrade') };
}

describe('a saved config that names every widget (pinned)', () => {
  it('reads back exactly as saved', () => {
    const order = ['actions', 'hero', 'growth', 'toGrade'];
    const disabled = without(ALL, ...order);
    expect(getCardWidgetConfigFromRaw({ order, disabled })).toEqual({ order, disabled });
  });

  it('drops keys that are no widget', () => {
    const order = ['hero', 'nope'];
    const disabled = without(ALL, 'hero').concat(['gone']);
    expect(getCardWidgetConfigFromRaw({ order, disabled })).toEqual({
      order: ['hero'],
      disabled: without(ALL, 'hero'),
    });
  });

  it('with no saved config, gives the defaults', () => {
    expect(getCardWidgetConfigFromRaw(null).order).toContain('toGrade');
    expect(getCardWidgetConfigFromRaw({}).order).toContain('toGrade');
  });
});

describe('a widget added after the teacher saved', () => {
  it('on by default: shown, after the widget before it in the registry', () => {
    const cfg = getCardWidgetConfigFromRaw(
      savedBefore(['hero', 'sectionBars', 'actions'], without(ALL, 'hero', 'sectionBars', 'actions')),
    );
    expect(cfg.order).toEqual(['hero', 'toGrade', 'sectionBars', 'actions']);
    expect(cfg.disabled).not.toContain('toGrade');
  });

  it('on by default, with the widget before it turned off: after the nearest one before it that is shown, or first', () => {
    const off = savedBefore(['growth', 'actions'], without(ALL, 'growth', 'actions'));
    expect(getCardWidgetConfigFromRaw(off).order).toEqual(['toGrade', 'growth', 'actions']);
  });

  it('every other widget keeps its place and its on or off', () => {
    const order = ['actions', 'growth', 'hero'];
    const disabled = without(ALL, ...order, 'toGrade');
    const cfg = getCardWidgetConfigFromRaw({ order, disabled });
    expect(without(cfg.order, 'toGrade')).toEqual(order);
    expect(cfg.disabled).toEqual(disabled);
  });

  it('one the teacher turned off stays off', () => {
    const order = ['hero', 'actions'];
    const disabled = without(ALL, ...order);
    expect(disabled).toContain('toGrade');
    expect(getCardWidgetConfigFromRaw({ order, disabled })).toEqual({ order, disabled });
  });

  it('off by default: off', () => {
    const order = without(ALL, 'missingWork');
    const cfg = getCardWidgetConfigFromRaw({ order, disabled: [] });
    expect(cfg.disabled).toEqual(['missingWork']);
    expect(cfg.order).toEqual(order);
  });

  it('a teacher’s saved config from the server gets it too', () => {
    localStorage.clear();
    _cache.config = { cardWidgetConfig: savedBefore(['hero', 'actions'], without(ALL, 'hero', 'actions')) };
    expect(getCardWidgetConfig().order).toEqual(['hero', 'toGrade', 'actions']);
    _cache.config = null;
  });
});
