/**
 * Router tests — teacher/router.js :: parseUrl, legacyUrl, isRoute, navigate
 */

var _activeElementDescriptor = Object.getOwnPropertyDescriptor(document, 'activeElement');

afterEach(() => {
  if (_activeElementDescriptor) {
    Object.defineProperty(document, 'activeElement', _activeElementDescriptor);
  } else {
    delete document.activeElement;
  }
});

describe('Router.parseUrl', () => {
  it('parses a path with params', () => {
    const result = Router.parseUrl('/student', '?id=st1&course=sci8');
    expect(result.path).toBe('/student');
    expect(result.params).toEqual({ id: 'st1', course: 'sci8' });
  });

  it('parses a path with no params', () => {
    const result = Router.parseUrl('/dashboard', '');
    expect(result.path).toBe('/dashboard');
    expect(result.params).toEqual({});
  });

  it('parses a two-part path', () => {
    expect(Router.parseUrl('/observations/starters', '').path).toBe('/observations/starters');
  });

  it('drops a trailing slash', () => {
    expect(Router.parseUrl('/gradebook/', '?course=math7').path).toBe('/gradebook');
  });

  it('defaults to /dashboard for an empty path', () => {
    expect(Router.parseUrl('', '').path).toBe('/dashboard');
    expect(Router.parseUrl(undefined, undefined).path).toBe('/dashboard');
  });

  it('decodes URL-encoded param values', () => {
    expect(Router.parseUrl('/student', '?name=John%20Doe').params.name).toBe('John Doe');
  });

  it('handles a param with an empty value', () => {
    expect(Router.parseUrl('/reports', '?filter=').params.filter).toBe('');
  });

  it('handles multiple params', () => {
    const result = Router.parseUrl('/student', '?id=s1&course=c1&tab=goals');
    expect(result.params).toEqual({ id: 's1', course: 'c1', tab: 'goals' });
  });

  it('keeps a broken %-code as typed instead of throwing', () => {
    const result = Router.parseUrl('/student', '?id=%E0%A4%A&course=c1');
    expect(result.params).toEqual({ id: '%E0%A4%A', course: 'c1' });
  });
});

describe('Router navigation flushes pending edits', () => {
  it('blurs the active input before destroying the current page', () => {
    var events = [];
    PageDashboard.destroy = () => {
      events.push('destroy');
    };

    var activeEl = {
      tagName: 'INPUT',
      isContentEditable: false,
      blur: () => {
        events.push('blur');
      },
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
      blur: () => {
        blurred = true;
      },
    };
    Object.defineProperty(document, 'activeElement', {
      configurable: true,
      get: () => activeEl,
    });

    Router.navigate('/reports', true);

    expect(blurred).toBe(true);
  });
});

describe('Router: a page that sends the teacher on from its init', () => {
  it('leaves the title of the page it went to', () => {
    var origReplace = history.replaceState;
    var origInit = PageDashboard.init;
    // Let the address follow replaceState, as the browser's does.
    history.replaceState = (state, title, url) => {
      var q = url.indexOf('?');
      location.pathname = q < 0 ? url : url.slice(0, q);
      location.search = q < 0 ? '' : url.slice(q);
    };
    PageDashboard.init = () => {
      PageDashboard.init = origInit;
      Router.navigate('/reports', true);
    };
    try {
      Router.navigate('/dashboard', true);
      expect(location.pathname).toBe('/reports');
      expect(document.title).toBe('FullVision \u2014 Reports');
    } finally {
      history.replaceState = origReplace;
      PageDashboard.init = origInit;
      location.pathname = '';
      location.search = '';
    }
  });
});

describe('Router.legacyUrl', () => {
  it('turns an old hash link into a clean address', () => {
    expect(Router.legacyUrl('/teacher/app.html', '', '#/gradebook?course=sci8')).toBe('/gradebook?course=sci8');
    expect(Router.legacyUrl('/teacher/app.html', '', '#/student?id=s1&course=c1&tab=goals')).toBe(
      '/student?id=s1&course=c1&tab=goals',
    );
  });

  it('sends app.html with no route, or an empty route, to the dashboard', () => {
    expect(Router.legacyUrl('/teacher/app.html', '', '')).toBe('/dashboard');
    expect(Router.legacyUrl('/teacher/app.html', '', '#/')).toBe('/dashboard');
  });

  it('leaves a hash that is not a route alone', () => {
    expect(Router.legacyUrl('/gradebook', '?course=sci8', '#main')).toBe(null);
  });

  it('drops a trailing slash and keeps the query', () => {
    expect(Router.legacyUrl('/gradebook/', '?course=sci8', '')).toBe('/gradebook?course=sci8');
  });

  it('leaves a clean address alone', () => {
    expect(Router.legacyUrl('/reports', '?tab=questionnaire', '')).toBe(null);
  });
});

describe('Router.isRoute', () => {
  it('knows the app pages', () => {
    [
      '/dashboard',
      '/assignments',
      '/student',
      '/gradebook',
      '/observations',
      '/observations/starters',
      '/reports',
    ].forEach(p => expect(Router.isRoute(p)).toBe(true));
    expect(Router.isRoute('/gradebook/')).toBe(true);
  });

  it('does not claim other pages', () => {
    ['/login.html', '/teacher-mobile/', '/s/', '/privacy.html', '/'].forEach(p =>
      expect(Router.isRoute(p)).toBe(false),
    );
  });
});
