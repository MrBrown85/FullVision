// Which addresses run an edge function, read from netlify.toml the way
// Netlify documents it (docs.netlify.com/build/edge-functions/declarations/):
// `path` and `excludedPath` are URLPattern pathname expressions, and a
// request runs the function when its path matches `path` and no
// `excludedPath`. URLPattern is the web standard Netlify links to; Node has
// it built in, so the match here is the standard's own, not a copy of it.
//
// Used by tests/edge-function-paths.test.js and scripts/e2e-server.mjs, so
// the browser tests run the function only where the live site would.

/** The [[edge_functions]] entries of a netlify.toml: { function, path, excludedPath }. */
export function edgeDeclarations(toml) {
  const blocks = toml.split(/^\[\[edge_functions\]\]\s*$/m).slice(1);
  return blocks.map(text => {
    const body = text.split(/^\[/m)[0].replace(/^\s*#.*$/gm, '');
    const str = key => {
      const m = body.match(new RegExp('^\\s*' + key + '\\s*=\\s*"([^"]*)"', 'm'));
      return m ? m[1] : null;
    };
    const list = key => {
      const arr = body.match(new RegExp('^\\s*' + key + '\\s*=\\s*\\[([\\s\\S]*?)\\]', 'm'));
      if (arr) return [...arr[1].matchAll(/"([^"]*)"/g)].map(m => m[1]);
      const one = str(key);
      return one === null ? [] : [one];
    };
    for (const key of ['pattern', 'excludedPattern', 'header', 'method']) {
      if (new RegExp('^\\s*' + key + '\\s*=', 'm').test(body))
        throw new Error('edge-function-paths: "' + key + '" is not handled here; extend this reader');
    }
    return { function: str('function'), path: str('path'), excludedPath: list('excludedPath') };
  });
}

function matches(expression, pathname) {
  return new URLPattern({ pathname: expression }).test({ pathname });
}

/** True when a request for this path runs the named function. */
export function edgeFunctionRuns(declarations, name, pathname) {
  return declarations.some(
    d => d.function === name && d.path && matches(d.path, pathname) && !d.excludedPath.some(x => matches(x, pathname)),
  );
}
