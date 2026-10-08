import { expect, test } from "bun:test";
import { greet } from "../src/index";

test("greet adds an exclamation mark when excited", () => {
  expect(greet({ excited: true, name: "world" })).toBe("hello world!");
});

test("greet ends with a period when not excited", () => {
  expect(greet({ excited: false, name: "world" })).toBe("hello world.");
});
