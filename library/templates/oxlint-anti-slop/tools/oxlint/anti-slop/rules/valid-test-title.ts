import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { testCallName } from "../shared/test-framework.ts";

function containsStringNode(node: ESTree.Expression): boolean {
  if (node.type === "Literal" && typeof node.value === "string") return true;
  if (node.type === "TemplateLiteral") return true;
  if (node.type === "BinaryExpression") {
    return containsStringNode(node.left) || containsStringNode(node.right);
  }
  return false;
}

// The static text of a title, or null when it is not statically known (a template with
// expressions, or a non-string expression).
function titleText(node: ESTree.Expression): string | null {
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/** Enforce a valid test title: non-empty, a string, no block-name prefix, no stray spaces. */
export const validTestTitleRule = defineRule({
  createOnce(context) {
    return {
      CallExpression(node) {
        const name = testCallName(context.sourceCode, node.callee);
        if (name === null) return;
        const callee = node.callee;
        // The `.each`/`.for` table wrapper's arguments are the table, not a title and a body.
        if (
          callee.type === "MemberExpression" &&
          !callee.computed &&
          (callee.property.name === "each" || callee.property.name === "for")
        ) {
          return;
        }
        const title = node.arguments[0];
        if (title === undefined || title.type === "SpreadElement") return;
        if (title.type === "ArrowFunctionExpression" || title.type === "FunctionExpression") return;

        const isString =
          (title.type === "Literal" && typeof title.value === "string") ||
          title.type === "TemplateLiteral";
        if (!isString) {
          if (title.type === "BinaryExpression" && containsStringNode(title)) return;
          context.report({ messageId: "titleMustBeString", node: title });
          return;
        }

        const text = titleText(title);
        if (text === null) return;
        if (text === "") {
          context.report({ data: { name }, messageId: "emptyTitle", node: title });
          return;
        }
        if (text.trim().length !== text.length) {
          context.report({ messageId: "accidentalSpace", node: title });
        }
        const [firstWord] = text.split(" ");
        if (firstWord !== undefined && firstWord.toLowerCase() === name) {
          context.report({ data: { name }, messageId: "duplicatePrefix", node: title });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Enforce a valid test title: non-empty, a string, not prefixed with its block name, and without leading or trailing spaces.",
    },
    messages: {
      accidentalSpace: "This title has leading or trailing spaces; trim it.",
      duplicatePrefix: "This title starts with its own block name (`{{name}}`); drop the prefix.",
      emptyTitle: "This `{{name}}` block has an empty title; name the behaviour it checks.",
      titleMustBeString: "A test title must be a string literal or a template literal.",
    },
    type: "suggestion",
  },
});
