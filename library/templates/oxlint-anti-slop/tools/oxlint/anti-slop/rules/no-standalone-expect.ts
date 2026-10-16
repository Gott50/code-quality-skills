import type { ESTree, SourceCode } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isExpectCall, isFunctionNode, testCallName } from "../shared/test-framework.ts";

// Whether an assertion runs as part of a test: inside a test block, or inside a helper function a
// test calls. An assertion directly in a suite body, or at the top level, runs at collection time.
// A callback that is neither a test nor a suite (a hook, a `.map` body) is transparent: the block
// that encloses it decides.
function isInsideTest(sourceCode: SourceCode, node: ESTree.Node): boolean {
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== "Program") {
    if (isFunctionNode(current)) {
      const parent = current.parent;
      if (current.type === "FunctionDeclaration" || parent.type === "VariableDeclarator") {
        return true;
      }
      if (parent.type === "CallExpression") {
        const name = testCallName(sourceCode, parent.callee);
        if (name === "test" || name === "it") return true;
        if (name === "describe") return false;
      }
    }
    current = current.parent;
  }
  return false;
}

/** Disallow assertions outside a test block, where they run at collection time. */
export const noStandaloneExpectRule = defineRule({
  createOnce(context) {
    return {
      CallExpression(node) {
        if (!isExpectCall(context.sourceCode, node.callee)) return;
        if (!isInsideTest(context.sourceCode, node)) {
          context.report({ messageId: "standaloneExpect", node });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Disallow assertions outside a test block; an assertion that never runs proves nothing.",
    },
    messages: {
      standaloneExpect:
        "This assertion is outside any test block, so it runs at collection time and never guards the behaviour. Move it into the test it belongs to.",
    },
    type: "problem",
  },
});
