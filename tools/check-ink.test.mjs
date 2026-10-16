import { test } from "node:test";
import assert from "node:assert/strict";
import { countDimInk } from "./check-ink.mjs";

test("flags text set to a border tone", () => {
  assert.equal(countDimInk(`<div style={{ fontSize: 9, color: "#33333a" }}>x</div>`), 1);
  assert.equal(countDimInk(`<span style={{ color: '#232327' }}>x</span>`), 1);
  assert.equal(countDimInk(`<text x={1} fill="#33333a" fontSize="9">$0</text>`), 1);
});

test("borders, backgrounds and underlines are not text", () => {
  assert.equal(countDimInk(`style={{ border: "1px solid #33333a", borderColor: "#33333a", background: "#232327" }}`), 0);
  assert.equal(countDimInk(`style={{ textDecorationColor: "#33333a" }}`), 0);
  assert.equal(countDimInk(`<rect fill="#232327" />`), 0);
});

test("readable ink passes", () => {
  assert.equal(countDimInk(`style={{ color: "#71717a" }} style={{ color: "#52525b" }}`), 0);
});
