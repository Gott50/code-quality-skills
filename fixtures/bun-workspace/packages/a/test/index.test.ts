import { expect, test } from "bun:test";
import { double } from "../src/index";

test("double returns twice the input", () => {
  expect(double(2)).toBe(4);
});
