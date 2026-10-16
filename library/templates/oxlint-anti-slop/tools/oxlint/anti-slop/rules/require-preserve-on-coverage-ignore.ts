import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

// The coverage ignore hints a transpiler strips unless the comment carries the
// `@preserve` marker: istanbul's `/* istanbul ignore … */`, c8's
// `/* c8 ignore … */`, and v8's `/* v8 ignore … */`. The `^` anchor keeps a
// comment that merely mentions the hint in prose from matching.
const IGNORE_HINT = /^(?:istanbul|v8|c8)\s+ignore\b/u;

/** Whether a block comment is a coverage ignore hint that lacks `@preserve`. */
function isInertIgnoreHint(comment: ESTree.Comment): boolean {
  if (comment.type !== "Block") return false;
  const value = comment.value.trim();
  return IGNORE_HINT.test(value) && !value.includes("@preserve");
}

/** Require `@preserve` on a coverage ignore hint so the transpiler keeps it. */
export const requirePreserveOnCoverageIgnoreRule = defineRule({
  createOnce(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (isInertIgnoreHint(comment)) {
            context.report({ messageId: "missingPreserve", node: comment });
          }
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Require `@preserve` on istanbul/v8/c8 coverage ignore hints; a transpiler strips the comment and the hint is silently inert.",
    },
    messages: {
      missingPreserve:
        "This coverage ignore hint has no `@preserve` marker, so the transpiler strips the comment and the hint never reaches the instrumenter. Write `/* … ignore … -- @preserve */`.",
    },
    type: "problem",
  },
});
