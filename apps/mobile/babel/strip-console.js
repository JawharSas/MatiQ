/**
 * Removes every `console.*` call from production bundles.
 *
 * Release builds are compiled to Hermes bytecode and Expo skips the JS
 * minifier for them, so this runs as a Babel transform instead of a Terser
 * option. Nothing logged during development (ids, server responses, error
 * details) can end up in a shipped binary or in device logs.
 */
module.exports = function stripConsole({ types: t }) {
  return {
    name: 'matiq-strip-console',
    visitor: {
      CallExpression(path) {
        const callee = path.get('callee');
        if (!callee.isMemberExpression()) return;
        const object = callee.get('object');
        if (!object.isIdentifier({ name: 'console' }) || path.scope.hasBinding('console')) return;
        if (path.parentPath.isExpressionStatement()) path.parentPath.remove();
        else path.replaceWith(t.unaryExpression('void', t.numericLiteral(0)));
      },
    },
  };
};
