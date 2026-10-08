import { expect, test } from "bun:test";
import { double } from "./index";

test("double returns twice the input", () => {
  expect(double(2)).toBe(4);
});
