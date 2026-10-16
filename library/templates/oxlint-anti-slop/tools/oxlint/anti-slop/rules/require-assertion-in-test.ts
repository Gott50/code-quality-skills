import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isExpectCall, testCallName, testCallback } from "../shared/test-framework.ts";

interface TestFrame {
  hasAssertion: boolean;
  node: ESTree.CallExpression;
}

/** Require every test block to make at least one assertion. */
export const requireAssertionInTestRule = defineRule({
  createOnce(context) {
    const frames: TestFrame[] = [];

    return {
      CallExpression(node) {
        const name = testCallName(context.sourceCode, node.callee);
        if (name === "test" || name === "it") {
          if (testCallback(node) !== null) frames.push({ hasAssertion: false, node });
          return;
        }
        if (isExpectCall(context.sourceCode, node.callee)) {
          const frame = frames[frames.length - 1];
          if (frame !== undefined) frame.hasAssertion = true;
        }
      },
      "CallExpression:exit"(node) {
        const frame = frames[frames.length - 1];
        if (frame === undefined || frame.node !== node) return;
        frames.pop();
        if (!frame.hasAssertion) context.report({ messageId: "missingAssertion", node });
      },
    };
  },
  meta: {
    docs: {
      description:
        "Require at least one assertion in every test block; a test that cannot fail is not a test.",
    },
    messages: {
      missingAssertion:
        "This test makes no assertion, so it passes whatever the code does. Assert the behaviour it names, or delete it.",
    },
    type: "problem",
  },
});
