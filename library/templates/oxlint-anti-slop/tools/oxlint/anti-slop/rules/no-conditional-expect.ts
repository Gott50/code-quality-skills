import type { ESTree, SourceCode } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isExpectCall, isFunctionNode, testCallName } from "../shared/test-framework.ts";

// The constructs that make an assertion conditional: a branch, a short-circuit, a catch.
const CONDITIONAL_TYPES: Record<string, true> = {
  CatchClause: true,
  ConditionalExpression: true,
  IfStatement: true,
  LogicalExpression: true,
  SwitchStatement: true,
};

// Whether an assertion is conditional within a test: it sits under a branch, a short-circuit, a
// catch, or a promise `.catch(...)` handler, and the nearest enclosing function is a test callback.
// A helper function's body is not the test's, so its assertions are not this rule's business.
function isConditionalInTest(sourceCode: SourceCode, node: ESTree.Node): boolean {
  let conditional = false;
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== "Program") {
    if (isFunctionNode(current)) {
      const parent = current.parent;
      if (parent.type !== "CallExpression") return false;
      const name = testCallName(sourceCode, parent.callee);
      if (name === "test" || name === "it") return conditional;
      if (name === "describe") return false;
      const callee = parent.callee;
      if (
        callee.type === "MemberExpression" &&
        !callee.computed &&
        callee.property.name === "catch"
      ) {
        conditional = true;
      }
    } else if (CONDITIONAL_TYPES[current.type] === true) {
      conditional = true;
    }
    current = current.parent;
  }
  return false;
}

/** Disallow assertions in conditional code, where a test can pass without asserting. */
export const noConditionalExpectRule = defineRule({
  createOnce(context) {
    return {
      CallExpression(node) {
        if (!isExpectCall(context.sourceCode, node.callee)) return;
        if (isConditionalInTest(context.sourceCode, node)) {
          context.report({ messageId: "conditionalExpect", node });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Disallow assertions inside conditional code; a branch that is not taken asserts nothing.",
    },
    messages: {
      conditionalExpect:
        "This assertion runs only when the branch is taken, so the test can pass without asserting. Assert the outcome unconditionally.",
    },
    type: "problem",
  },
});
