// ESLint rule fv/guarded-globals: no-undef for the files in
// scripts/lint-ratchet.mjs, except that a name is allowed where a `typeof`
// test guards it. A name the page may not have (a desktop-only script, or one
// loaded on demand such as shared/seed-data.js) is safe only there:
//
//   if (typeof showSyncToast === 'function') showSyncToast(...);
//   typeof LEARNING_MAP !== 'undefined' && LEARNING_MAP[cid]
//   typeof DEFAULT_COURSES !== 'undefined' ? structuredClone(DEFAULT_COURSES) : {}
//
// Guarded means: in the `then` branch of an `if` or `? :`, or on the right of
// `&&`, whose test (or one of its `&&` parts) is `typeof X !== 'undefined'`,
// `typeof X === 'function'` or `typeof X === 'object'` (`!=`/`==` too).
// Option `where` maps a name to a sentence on where it is defined, for the
// message.

const PRESENT = {
  '!==': ['undefined'],
  '!=': ['undefined'],
  '===': ['function', 'object'],
  '==': ['function', 'object'],
};

function isTypeofOf(node, name) {
  return (
    node &&
    node.type === 'UnaryExpression' &&
    node.operator === 'typeof' &&
    node.argument.type === 'Identifier' &&
    node.argument.name === name
  );
}

// True when `test` being truthy means `name` exists.
function asserts(test, name) {
  if (!test) return false;
  if (test.type === 'LogicalExpression' && test.operator === '&&') {
    return asserts(test.left, name) || asserts(test.right, name);
  }
  if (test.type === 'BinaryExpression' && PRESENT[test.operator]) {
    const typeofSide = isTypeofOf(test.left, name) ? test.left : isTypeofOf(test.right, name) ? test.right : null;
    if (!typeofSide) return false;
    const other = typeofSide === test.left ? test.right : test.left;
    return other.type === 'Literal' && PRESENT[test.operator].includes(other.value);
  }
  return false;
}

function isGuarded(identifier, name) {
  let child = identifier;
  for (let parent = child.parent; parent; child = parent, parent = parent.parent) {
    if ((parent.type === 'IfStatement' || parent.type === 'ConditionalExpression') && child === parent.consequent) {
      if (asserts(parent.test, name)) return true;
    }
    if (parent.type === 'LogicalExpression' && parent.operator === '&&' && child === parent.right) {
      if (asserts(parent.left, name)) return true;
    }
  }
  return false;
}

export const guardedGlobals = {
  meta: {
    type: 'problem',
    schema: [
      {
        type: 'object',
        properties: { where: { type: 'object', additionalProperties: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const where = (context.options[0] && context.options[0].where) || {};
    const sourceCode = context.sourceCode;
    return {
      'Program:exit'(node) {
        for (const ref of sourceCode.getScope(node).through) {
          const id = ref.identifier;
          const name = id.name;
          if (id.parent.type === 'UnaryExpression' && id.parent.operator === 'typeof') continue;
          const known = where[name];
          if (known && isGuarded(id, name)) continue;
          const message = known
            ? `'${name}' is not on every page that loads this file: ${known} ` +
              `Guard this use with \`typeof ${name}\` (if, ? : or &&), or load its script with a <script> tag on both pages.`
            : `'${name}' is not defined by any script the pages load. A typo, or a script missing from teacher/app.html and teacher-mobile/index.html?`;
          context.report({ node: id, message });
        }
      },
    };
  },
};
