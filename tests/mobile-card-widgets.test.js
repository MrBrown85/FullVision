import './setup.js';
import { describe, it, expect, beforeEach } from 'vitest';

describe('Card Widget Config', () => {
  beforeEach(() => {
    localStorage.clear();
    if (typeof _cache !== 'undefined') {
      // Clear any cached widget config
      delete _cache.cardWidgets;
    }
  });

  it('returns default config when no localStorage entry exists', () => {
    var config = getCardWidgetConfig();
    expect(config.order).toEqual(['hero', 'sectionBars', 'obsSnippet', 'actions']);
    expect(config.disabled).toContain('completion');
    expect(config.disabled).toContain('dispositions');
    expect(config.disabled).toContain('narrative');
    expect(config.disabled.length).toBe(12);
  });

  it('reads saved config from localStorage', () => {
    var custom = {
      order: ['hero', 'completion', 'actions'],
      disabled: ['sectionBars', 'obsSnippet', 'missingWork', 'growth', 'obsSummary',
                 'flagStatus', 'reflection', 'dispositions', 'traits', 'concerns',
                 'workHabits', 'growthAreas', 'narrative']
    };
    localStorage.setItem('m-card-widgets', JSON.stringify(custom));
    var config = getCardWidgetConfig();
    expect(config.order).toEqual(['hero', 'completion', 'actions']);
  });

  it('saves config to localStorage', () => {
    var config = {
      order: ['hero', 'sectionBars', 'completion', 'obsSnippet', 'actions'],
      disabled: ['missingWork', 'growth', 'obsSummary', 'flagStatus', 'reflection',
                 'dispositions', 'traits', 'concerns', 'workHabits', 'growthAreas', 'narrative']
    };
    saveCardWidgetConfig(config);
    var raw = JSON.parse(localStorage.getItem('m-card-widgets'));
    expect(raw.order).toEqual(config.order);
  });

  it('handles new widgets added in future releases', () => {
    var old = {
      order: ['hero', 'sectionBars', 'obsSnippet', 'actions'],
      disabled: ['completion', 'missingWork']
    };
    localStorage.setItem('m-card-widgets', JSON.stringify(old));
    var config = getCardWidgetConfig();
    expect(config.disabled).toContain('growth');
    expect(config.disabled).toContain('dispositions');
    expect(config.disabled).toContain('narrative');
  });

  it('ignores unknown widget keys in localStorage', () => {
    var bad = {
      order: ['hero', 'unknownWidget', 'actions'],
      disabled: ['sectionBars']
    };
    localStorage.setItem('m-card-widgets', JSON.stringify(bad));
    var config = getCardWidgetConfig();
    expect(config.order).not.toContain('unknownWidget');
  });
});
