import { test } from "node:test";
import assert from "node:assert/strict";
import { countMonoButtons, openingTag } from "./check-ui.mjs";

test("counts a button whose inline style sets the mono face", () => {
  assert.equal(countMonoButtons(`<button onClick={go} style={{ fontFamily: MONO, fontSize: 11 }}>GO</button>`), 1);
  assert.equal(countMonoButtons(`<a href="/x" style={{ fontFamily: "var(--nx-font-mono)" }}>x</a>`), 1);
  assert.equal(countMonoButtons(`<button style={{ fontFamily: MF }}>x</button>`), 1);
  // router links are buttons too (the BUY $NEXUS CTA was a <Link> the first version missed)
  assert.equal(countMonoButtons(`<Link to="/x" style={{ fontFamily: "var(--nx-font-mono)" }}>BUY</Link>`), 1);
  assert.equal(countMonoButtons(`<LinkPreview style={{ fontFamily: MONO }} />`), 0);
});

test("ignores the UI face, labels and non-button tags", () => {
  assert.equal(countMonoButtons(`<button style={{ fontFamily: UI }}>Go</button>`), 0);
  assert.equal(countMonoButtons(`<span style={{ fontFamily: MONO }}>LABEL</span>`), 0);
  assert.equal(countMonoButtons(`<abbr style={{ fontFamily: MONO }}>x</abbr>`), 0);
  // a mono label INSIDE a UI button is a label, not the button's face
  assert.equal(countMonoButtons(`<button style={{ fontFamily: UI }}><span style={{ fontFamily: MONO }}>x</span></button>`), 0);
});

test("the opening tag ends at the first > outside braces (arrows and quotes don't end it)", () => {
  const src = `<button onClick={() => a > b && go()} title="a > b" style={{ fontFamily: MONO }}>x</button>`;
  const tag = openingTag(src, 0);
  assert.ok(tag.endsWith(`style={{ fontFamily: MONO }}>`));
  assert.equal(countMonoButtons(src), 1);
});
