import assert from "node:assert/strict";
import test from "node:test";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "../button";

const variants: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];
const sizes: ButtonSize[] = ["sm", "md"];

test("defaults to the primary medium button", () => {
  assert.equal(buttonClasses(), buttonClasses("primary", "md"));
});

test("each variant produces a distinct class set", () => {
  const classSets = variants.map((variant) => buttonClasses(variant));
  assert.equal(new Set(classSets).size, variants.length);
});

test("each size produces a distinct class set", () => {
  const classSets = sizes.map((size) => buttonClasses("primary", size));
  assert.equal(new Set(classSets).size, sizes.length);
});

test("primary uses the rose fill with dark text and hover glow", () => {
  const classes = buttonClasses("primary").split(" ");
  assert.ok(classes.includes("bg-rose"));
  assert.ok(classes.includes("text-canvas"));
  assert.ok(classes.includes("hover:shadow-button"));
});

test("secondary uses a surface with a line border", () => {
  const classes = buttonClasses("secondary").split(" ");
  assert.ok(classes.includes("bg-surface-2"));
  assert.ok(classes.includes("border-line"));
});

test("includes disabled styles and appends extra classes", () => {
  const classes = buttonClasses("ghost", "sm", "w-full").split(" ");
  assert.ok(classes.includes("disabled:opacity-50"));
  assert.ok(classes.includes("disabled:cursor-not-allowed"));
  assert.equal(classes.at(-1), "w-full");
});
