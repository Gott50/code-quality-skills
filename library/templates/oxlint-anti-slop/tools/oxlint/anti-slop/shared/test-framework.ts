import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

// The modules a test framework's functions are imported from: Bun's runner, Vitest, and Jest's
// globals package. A name imported from anywhere else is not a test-framework function.
const TEST_SOURCES: Record<string, true> = {
  "@jest/globals": true,
  "bun:test": true,
  vitest: true,
};

// The block functions a test file declares. `test` and `it` are test blocks; `describe` is a suite.
const TEST_FUNCTIONS: Record<string, true> = { describe: true, it: true, test: true };

// The modifiers a test function carries before its title: `test.only`, `test.each`, `it.skip`, ...
const TEST_MODIFIERS: Record<string, true> = {
  concurrent: true,
  each: true,
  failing: true,
  for: true,
  only: true,
  skip: true,
  todo: true,
};

// The assertion function. `expect.soft` and `expect.poll` are assertions too; the other members
// (`expect.any`, `expect.assertions`, ...) are matcher helpers, not assertions.
const EXPECT_FUNCTIONS: Record<string, true> = { expect: true };
const EXPECT_ASSERTION_MEMBERS: Record<string, true> = { poll: true, soft: true };

function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

function importedName(node: ESTree.Node): string | null {
  if (node.type !== "ImportSpecifier") return null;
  return node.imported.type === "Identifier" ? node.imported.name : node.imported.value;
}

// Whether `identifier` names a function of a test framework: a global of that name, or a binding
// imported from one of TEST_SOURCES. A local declaration of the same name is not one.
function isTestFrameworkIdentifier(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
  names: Record<string, true>,
): boolean {
  if (names[identifier.name] !== true) return false;
  if (sourceCode.isGlobalReference(identifier)) return true;
  const variable = resolveVariable(sourceCode, identifier);
  if (variable === null || variable.defs.length === 0) return true;
  return variable.defs.some((definition) => {
    if (definition.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
      return false;
    }
    return (
      TEST_SOURCES[definition.parent.source.value] === true &&
      importedName(definition.node) === identifier.name
    );
  });
}

// The base test function a call target names, or null when it names none. Handles the modifiers
// (`test.only`, `it.skip`) and the `.each`/`.for` wrapper, whose outer call's callee is itself a
// call or a tagged template: `test.each([...])("title", fn)`.
export function testCallName(sourceCode: SourceCode, callee: ESTree.Expression): string | null {
  if (callee.type === "CallExpression") return testCallName(sourceCode, callee.callee);
  if (callee.type === "TaggedTemplateExpression") return testCallName(sourceCode, callee.tag);
  if (callee.type === "Identifier") {
    return isTestFrameworkIdentifier(sourceCode, callee, TEST_FUNCTIONS) ? callee.name : null;
  }
  if (callee.type === "MemberExpression" && !callee.computed) {
    const object = callee.object;
    if (
      object.type === "Identifier" &&
      isTestFrameworkIdentifier(sourceCode, object, TEST_FUNCTIONS) &&
      TEST_MODIFIERS[callee.property.name] === true
    ) {
      return object.name;
    }
  }
  return null;
}

// Whether a call target is an assertion: `expect(...)`, or `expect.soft(...)`/`expect.poll(...)`.
export function isExpectCall(sourceCode: SourceCode, callee: ESTree.Expression): boolean {
  if (callee.type === "Identifier") {
    return isTestFrameworkIdentifier(sourceCode, callee, EXPECT_FUNCTIONS);
  }
  if (callee.type === "MemberExpression" && !callee.computed) {
    const object = callee.object;
    return (
      object.type === "Identifier" &&
      isTestFrameworkIdentifier(sourceCode, object, EXPECT_FUNCTIONS) &&
      EXPECT_ASSERTION_MEMBERS[callee.property.name] === true
    );
  }
  return false;
}

// The function a test call runs: the last function argument, or null for a body-less call
// (`test.todo("...")`, `test.skip("...")`).
export function testCallback(
  node: ESTree.CallExpression,
): ESTree.ArrowFunctionExpression | ESTree.Function | null {
  for (let i = node.arguments.length - 1; i >= 0; i--) {
    const argument = node.arguments[i];
    if (argument.type === "ArrowFunctionExpression" || argument.type === "FunctionExpression") {
      return argument;
    }
  }
  return null;
}

// A function boundary: a nested function's body is not the test's own body.
export function isFunctionNode(node: ESTree.Node): boolean {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression"
  );
}
