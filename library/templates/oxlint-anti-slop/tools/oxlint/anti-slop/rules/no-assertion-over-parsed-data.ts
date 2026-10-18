import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

function unwrapExpressionParentheses(expression: ESTree.Expression): ESTree.Expression {
  let current = expression;
  while (current.type === "ParenthesizedExpression") {
    current = current.expression;
  }
  return current;
}

// `await` binds tighter than `as`, so `await res.json() as T` parses as
// `(await res.json()) as T`; an explicit `await (… as T)` puts the assertion
// inside the await instead. Unwrap either shape so both are seen.
function unwrapAwait(expression: ESTree.Expression): ESTree.Expression {
  let current = unwrapExpressionParentheses(expression);
  while (current.type === "AwaitExpression") {
    current = unwrapExpressionParentheses(current.argument);
  }
  return current;
}

function isIdentifierNamed(node: ESTree.Node, name: string): boolean {
  return node.type === "Identifier" && node.name === name;
}

// `JSON.parse(...)` — the canonical parse of a string the program did not
// produce.
function isJsonParseCall(node: ESTree.Expression): boolean {
  const call = unwrapExpressionParentheses(node);
  if (call.type !== "CallExpression") return false;
  const callee = unwrapExpressionParentheses(call.callee);
  if (callee.type !== "MemberExpression") return false;
  return isIdentifierNamed(callee.object, "JSON") && isIdentifierNamed(callee.property, "parse");
}

// `<something>.json()` — the fetch and axios response shape. The method name
// alone is the evidence: a `.json()` call deserializes a body the program did
// not author, whatever the receiver is called.
function isJsonMethodCall(node: ESTree.Expression): boolean {
  const call = unwrapExpressionParentheses(node);
  if (call.type !== "CallExpression") return false;
  const callee = unwrapExpressionParentheses(call.callee);
  return (
    callee.type === "MemberExpression" &&
    callee.computed === false &&
    isIdentifierNamed(callee.property, "json")
  );
}

// Whether the asserted expression is data parsed from outside the program.
function isParsedExternalData(expression: ESTree.Expression): boolean {
  const value = unwrapAwait(expression);
  return isJsonParseCall(value) || isJsonMethodCall(value);
}

/** Disallow a type assertion over parsed external data — validate it at the boundary instead. */
export const noAssertionOverParsedDataRule = defineRule({
  createOnce(context) {
    const checkAssertion = (node: TypeAssertionExpression) => {
      if (!isParsedExternalData(node.expression)) return;
      context.report({ messageId: "parsed", node });
    };

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
  meta: {
    docs: {
      description:
        "Disallow `JSON.parse(...) as T` and `await response.json() as T`: an assertion over parsed external data skips the boundary decode.",
    },
    messages: {
      parsed:
        "This asserts the type of parsed external data, so the boundary is not validated. Decode it at the I/O boundary with a validator and pass the typed value inward.",
    },
    type: "problem",
  },
});
