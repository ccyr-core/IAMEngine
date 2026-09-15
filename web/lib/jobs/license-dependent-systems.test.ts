import { test } from "node:test";
import assert from "node:assert/strict";
import { LICENSE_DEPENDENT_SYSTEMS } from "./runner-logic";

// FR #0000133: "Rather than showing a Warning, Microsoft 365 should fail if a license isn't available
// during an Onboarding to prevent further steps from being completed, as a license not being on the
// account means additional steps on the onboarding can't proceed."
//
// The mechanism the requester is asking for already exists. FR #5 made a seat shortage HOLD the
// license-dependent siblings: the m365 step succeeds with a WARN, runner-service.ts stamps a `hold`
// reason on each dependent job, and a later licensed re-run clears it. Holding rather than failing is
// what keeps the licence picker (result.AvailableLicenses) and the procurement-case watch working --
// both of which key off a SUCCEEDED status.
//
// The gap is the list, not the mechanism: it named only mimecast and spanning. An unlicensed user has
// no mailbox, so exchange (mailbox properties, shared-mailbox access, distribution groups), teams and
// sharepoint/OneDrive provisioning were all still dispatched against an account that cannot hold any
// of them -- which is exactly the "additional steps can't proceed" the request describes.

test("the systems that cannot run against an unlicensed user are all held", () => {
  for (const key of ["mimecast", "spanning", "exchange", "teams", "sharepoint"]) {
    assert.ok(
      LICENSE_DEPENDENT_SYSTEMS.includes(key),
      `${key} needs a licensed mailbox/account and must be held on a seat shortage`
    );
  }
});

test("systems that work without an M365 licence are NOT held", () => {
  // Holding these would stall an onboarding for no reason: an AD account, a laptop and a Zoom seat
  // are all perfectly creatable while the M365 licence is still being ordered.
  for (const key of ["active-directory", "zoom", "hardware", "slack", "knowbe4"]) {
    assert.ok(!LICENSE_DEPENDENT_SYSTEMS.includes(key), `${key} does not need an M365 licence — holding it would stall the onboard`);
  }
});

test("every entry is a real system key", () => {
  // A typo here holds nothing and fails silently, which is the failure mode this whole area keeps
  // producing. These are the keys used by the module specs in docs/modules.
  const known = ["mimecast", "spanning", "exchange", "teams", "sharepoint"];
  for (const key of LICENSE_DEPENDENT_SYSTEMS) assert.ok(known.includes(key), `unknown system key: ${key}`);
});
