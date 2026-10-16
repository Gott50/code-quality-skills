import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isExpectCall, testCallName, testCallback } from "../shared/test-framework.ts";

const DEFAULT_MAX = 5;

interface TestFrame {
  count: number;
  node: ESTree.CallExpression;
}

/** Cap the number of assertions in one test block. */
export const maxExpectsPerTestRule = defineRule({
  createOnce(context) {
    const option = context.options?.[0];
    const max =
      typeof option === "object" &&
      option !== null &&
      !Array.isArray(option) &&
      typeof option.max === "number"
        ? option.max
        : DEFAULT_MAX;
    const frames: TestFrame[] = [];

    return {
      CallExpression(node) {
        const name = testCallName(context.sourceCode, node.callee);
        if (name === "test" || name === "it") {
          if (testCallback(node) !== null) frames.push({ count: 0, node });
          return;
        }
        if (isExpectCall(context.sourceCode, node.callee)) {
          const frame = frames[frames.length - 1];
          if (frame !== undefined) frame.count += 1;
        }
      },
      "CallExpression:exit"(node) {
        const frame = frames[frames.length - 1];
        if (frame === undefined || frame.node !== node) return;
        frames.pop();
        if (frame.count > max) {
          context.report({ data: { count: frame.count, max }, messageId: "tooManyExpects", node });
        }
      },
    };
  },
  meta: {
    defaultOptions: [{ max: DEFAULT_MAX }],
    docs: {
      description:
        "Cap the number of assertions in one test; more assertions tend to mix several objectives.",
    },
    messages: {
      tooManyExpects:
        "This test makes {{count}} assertions (max {{max}}). Split it so each test has one reason to fail.",
    },
    schema: [
      {
        additionalProperties: false,
        properties: { max: { type: "number" } },
        type: "object",
      },
    ],
    type: "suggestion",
  },
});
