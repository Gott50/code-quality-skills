import { expect, test } from "vitest";
import { square } from "../src/index";

test("square returns each value times itself", () => {
  expect(square([3, 4])).toEqual([9, 16]);
});

test("square returns an empty list unchanged", () => {
  expect(square([])).toEqual([]);
});
