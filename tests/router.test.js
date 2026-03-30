/**
 * Router tests — gb-router.js :: Router.parseHash()
 * Pure string parsing, no DOM needed.
 */

var _activeElementDescriptor = Object.getOwnPropertyDescriptor(document, 'activeElement');

afterEach(() => {
  if (_activeElementDescriptor) {
    Object.defineProperty(document, 'activeElement', _activeElementDescriptor);
  } else {
    delete document.activeElement;
  }
});

describe('Router.parseHash', () => {
  it('parses hash with path and params', () => {
    const result = Router.parseHash('#/student?id=st1&course=sci8');
    expect(result.path).toBe('/student');
    expect(result.params).toEqual({ id: 'st1', course: 'sci8' });
  });

  it('parses hash with no params', () => {
    const result = Router.parseHash('#/dashboard');
    expect(result.path).toBe('/dashboard');
    expect(result.params).toEqual({});
  });

  it('defaults to /dashboard for empty hash', () => {
    expect(Router.parseHash('').path).toBe('/dashboard');
    expect(Router.parseHash('').params).toEqual({});
  });

  it('defaults to /dashboard for # only', () => {
    expect(Router.parseHash('#').path).toBe('/dashboard');
  });

  it('defaults to /dashboard for #/', () => {
    expect(Router.parseHash('#/').path).toBe('/dashboard');
  });

  it('decodes URL-encoded param values', () => {
    const result = Router.parseHash('#/student?name=John%20Doe');
    expect(result.params.name).toBe('John Doe');
  });

  it('handles single param', () => {
    const result = Router.parseHash('#/gradebook?course=math7');
    expect(result.path).toBe('/gradebook');
    expect(result.params).toEqual({ course: 'math7' });
  });

  it('handles param with empty value', () => {
    const result = Router.parseHash('#/reports?filter=');
    expect(result.params.filter).toBe('');
  });

  it('handles multiple params', () => {
    const result = Router.parseHash('#/student?id=s1&course=c1&tab=goals');
    expect(Object.keys(result.params)).toHaveLength(3);
    expect(result.params.id).toBe('s1');
    expect(result.params.course).toBe('c1');
    expect(result.params.tab).toBe('goals');
  });

  it('handles null/undefined input', () => {
    expect(Router.parseHash(null).path).toBe('/dashboard');
    expect(Router.parseHash(undefined).path).toBe('/dashboard');
  });
});

describe('Router navigation flushes pending edits', () => {
  it('blurs the active input before destroying the current page', () => {
    var events = [];
    PageDashboard.destroy = () => { events.push('destroy'); };

    var activeEl = {
      tagName: 'INPUT',
      isContentEditable: false,
      blur: () => { events.push('blur'); },
    };
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => activeEl,
    });

    Router.navigate('/assignments', true);

    expect(events).toEqual(['blur', 'destroy']);
  });

  it('blurs contenteditable elements before route teardown', () => {
    var blurred = false;
    var activeEl = {
      tagName: 'DIV',
      isContentEditable: true,
      blur: () => { blurred = true; },
    };
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => activeEl,
    });

    Router.navigate('/reports', true);

    expect(blurred).toBe(true);
  });
});
