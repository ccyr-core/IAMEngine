import { test } from "node:test";
import assert from "node:assert/strict";
import { provisionedUpnFrom, sharepointOnboardFields } from "./provisioned-upn";

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

// PR #111 reviews 2 + 3: wait ONLY while an api cloud-account step that will report the account is
// unfinished. A step that never will must not make the mirror refuse forever.
test("sharepoint onboard fields: an unfinished api m365/entra step means wait", () => {
  for (const status of ["pending", "dispatched", "running", "failed"]) {   // failed = e.g. DECISION_NEEDED, not accepted
    assert.deepEqual(sharepointOnboardFields([{ systemKey: "m365", mode: "api", status, result: null }]), { provisionedUpn: null, awaitCloudAccount: true }, status);
  }
});

test("sharepoint onboard fields: a step that reported the account hands it on (no wait)", () => {
  assert.deepEqual(sharepointOnboardFields([{ systemKey: "entra", mode: "api", status: "succeeded", result: { Upn: "a@x.com" } }]), { provisionedUpn: "a@x.com", awaitCloudAccount: false });
});

test("sharepoint onboard fields: a step that will never report the account does not mean wait", () => {
  const never = [
    { systemKey: "m365", mode: "manual", status: "manual", result: null },                        // manual checklist item
    { systemKey: "m365", mode: "api", status: "manual", result: null },                           // planned manual (secrets not needed)
    { systemKey: "m365", mode: "scim", status: "succeeded", result: null },                       // scim, born succeeded
    { systemKey: "m365", mode: "api", status: "succeeded", result: { priorStatus: "failed", manualCompletion: true } }, // done by hand
    { systemKey: "m365", mode: "api", status: "succeeded", result: { Status: "ok" } },             // succeeded without a Upn
    { systemKey: "m365", mode: "api", status: "skipped", result: null },
    { systemKey: "m365", mode: "api", status: "failed", result: null, accepted: true },            // operator accepted the failure
  ];
  for (const s of never) assert.deepEqual(sharepointOnboardFields([s]), { provisionedUpn: null, awaitCloudAccount: false }, JSON.stringify(s));
  assert.deepEqual(sharepointOnboardFields([]), { provisionedUpn: null, awaitCloudAccount: false });
});
