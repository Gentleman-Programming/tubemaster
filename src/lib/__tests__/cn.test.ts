import assert from "node:assert/strict";
import test from "node:test";
import { cn } from "../cn";

test("joins truthy class strings with single spaces", () => {
  assert.equal(cn("a", "b", "c"), "a b c");
});

test("skips falsy values and empty strings", () => {
  assert.equal(cn("a", false, null, undefined, "", 0, "b"), "a b");
});

test("flattens nested arrays", () => {
  assert.equal(cn(["a", ["b", false, ["c"]]], "d"), "a b c d");
});

test("includes object keys whose value is truthy", () => {
  assert.equal(cn({ a: true, b: false, c: undefined }, { d: true }), "a d");
});

test("trims surrounding whitespace in string parts", () => {
  assert.equal(cn("  a  ", " b"), "a b");
});

test("returns an empty string without classes", () => {
  assert.equal(cn(), "");
  assert.equal(cn(false, [null]), "");
});
