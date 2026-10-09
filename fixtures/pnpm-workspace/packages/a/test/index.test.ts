import { expect, test } from "vitest";
import { double } from "../src/index";

test("double returns each value twice", () => {
  expect(double([3, 4])).toEqual([6, 8]);
});

test("double returns an empty list unchanged", () => {
  expect(double([])).toEqual([]);
});
