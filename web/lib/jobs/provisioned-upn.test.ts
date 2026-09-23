import { test } from "node:test";
import assert from "node:assert/strict";
import { provisionedUpnFrom } from "./provisioned-upn";

// PR #111 review: the hire created at a FALLBACK username must be the one downstream steps act on.
test("the created account comes from the m365 result, not the payload's primary candidate", () => {
  const upn = provisionedUpnFrom([{ systemKey: "m365", status: "succeeded", result: { System: "m365", Status: "ok", Upn: "john.smith2@contoso.com" } }]);
  assert.equal(upn, "john.smith2@contoso.com");
});

test("an array-shaped result is unwrapped, and entra is used when there is no m365 step", () => {
  assert.equal(provisionedUpnFrom([{ systemKey: "entra", status: "succeeded", result: [null, { Upn: "a@x.com" }] }]), "a@x.com");
});

test("m365 wins over entra; a failed or result-less step gives nothing", () => {
  assert.equal(
    provisionedUpnFrom([
      { systemKey: "entra", status: "succeeded", result: { Upn: "e@x.com" } },
      { systemKey: "m365", status: "succeeded", result: { Upn: "m@x.com" } },
    ]),
    "m@x.com"
  );
  assert.equal(provisionedUpnFrom([{ systemKey: "m365", status: "failed", result: { Upn: "m@x.com" } }]), null);
  assert.equal(provisionedUpnFrom([{ systemKey: "m365", status: "succeeded", result: { priorStatus: "failed", manualCompletion: true } }]), null);
  assert.equal(provisionedUpnFrom([]), null);
});
