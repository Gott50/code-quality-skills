import { expect, test } from "bun:test";
import { square } from "./index";

test("square returns the value times itself", () => {
  expect(square(3)).toBe(9);
});
