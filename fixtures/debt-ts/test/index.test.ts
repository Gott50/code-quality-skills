import { expect, test } from "bun:test";
import { describeHttpStatus, describeInput, formatDuration, greet } from "../src/index";

test("greet adds an exclamation mark when excited", () => {
  expect(greet({ excited: true, name: "world" })).toBe("hello world!");
});

test("greet ends with a period when not excited", () => {
  expect(greet({ excited: false, name: "world" })).toBe("hello world.");
});

test("describeInput labels a number", () => {
  expect(describeInput(7)).toBe("number:7");
});

test("describeHttpStatus names a couple of common codes", () => {
  expect(describeHttpStatus(200)).toBe("ok");
  expect(describeHttpStatus(404)).toBe("not found");
});

test("formatDuration renders seconds under a minute", () => {
  expect(formatDuration(30)).toBe("30s");
});
