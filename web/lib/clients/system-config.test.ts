import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSystemConfig } from "./system-config";

// FR #0000132: "Onboarding tries to add a user with a license even though I've specified in the .json
// file that they are to get Type 1 with no license."
//
// core2272's zoom config was {"intent":{"onboard":{"type":1},"offboard":"disable"}} -- the onboard
// block nested INSIDE intent. `intent` carries exactly one thing, the offboard disable/destructive
// classification (systems-editor.tsx:299 writes only intent.offboard, and every other client reads
// {"offboard":"disable"}); step config belongs at the top level, as core519's working
// {"onboard":{"type":1}} shows.
//
// Nothing read intent.onboard, so Coretelligent.Zoom.psm1:195 fell through to its default -- `?? 2`,
// Licensed -- and bought a Pro seat on every onboard, against an explicit instruction not to. The PUT
// route sanitizes mode, lanes, dependsOn and every boolean, and then passes config straight through
// as `o.config ?? null`. A config nobody reads is accepted in silence and ignored in silence.

test("a config with no intent at all is fine", () => {
  assert.equal(validateSystemConfig({ onboard: { type: 1 } }), null);
  assert.equal(validateSystemConfig(null), null);
  assert.equal(validateSystemConfig({}), null);
});

test("the classification intent every client uses is accepted", () => {
  assert.equal(validateSystemConfig({ intent: { offboard: "disable" } }), null);
  assert.equal(validateSystemConfig({ intent: { offboard: "destructive" } }), null);
  assert.equal(validateSystemConfig({ intent: { offboard: "disable" }, onboard: { type: 1 } }), null);
});

test("step config nested inside intent is refused, and the message says where it belongs", () => {
  const err = validateSystemConfig({ intent: { onboard: { type: 1 }, offboard: "disable" } });
  assert.ok(err, "intent.onboard must not be accepted in silence");
  assert.match(String(err), /intent\.onboard/);
  assert.match(String(err), /config\.onboard/); // tells the operator where to put it
});

test("any unknown key inside intent is refused, not just onboard", () => {
  const err = validateSystemConfig({ intent: { offboard: "disable", typo: true } });
  assert.match(String(err), /typo/);
});

test("an unreadable offboard classification is refused", () => {
  // "disabled" is not "disable"; silently treating it as the destructive default would be worse.
  const err = validateSystemConfig({ intent: { offboard: "disabled" } });
  assert.match(String(err), /disable|destructive/);
});

test("a non-object intent is refused rather than coerced", () => {
  assert.ok(validateSystemConfig({ intent: "disable" }));
  assert.ok(validateSystemConfig({ intent: ["disable"] }));
});
