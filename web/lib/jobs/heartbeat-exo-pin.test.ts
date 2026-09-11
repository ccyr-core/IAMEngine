import { test } from "node:test";
import assert from "node:assert/strict";
import { exoPinPatch } from "./runner-service";

// ExchangeOnlineManagement 3.10.0's REST cmdlets call HttpResponseMessage.GetResponseHeader(), which
// PS7.6 removed, so every Exchange job dies. The runner pins 3.9.2 and self-heals it at startup -- but
// the self-heal ran Install-Module INSIDE the runner process, where PowerShellGet refuses while
// PackageManagement is loaded. It failed on every startup on core1748, reported only via a
// Write-Warning, which a Windows SYSTEM scheduled task discards. UM0031200 was the bill.

test("a healthy pin clears a recorded failure", () => {
  // The runner having the pin outranks a reason it did not, earlier -- mirrors the browser capability.
  assert.deepEqual(exoPinPatch(true, null), { exoPinError: null });
  assert.deepEqual(exoPinPatch(true, "a stale reason from the last boot"), { exoPinError: null });
});

test("a reported failure is recorded", () => {
  const p = exoPinPatch(false, "could not install the ExchangeOnlineManagement 3.9.2 pin; Exchange jobs will load 3.10.0 instead. Reason: The version '1.4.8.1' of module 'PackageManagement' is currently in use.");
  assert.match(String(p.exoPinError), /PackageManagement/);
  assert.match(String(p.exoPinError), /3\.10\.0/);
});

test("a legacy runner that reports neither writes nothing", () => {
  // Pre-1.122 runners send no exoPin fields at all. Absence must never be read as a failure.
  assert.deepEqual(exoPinPatch(undefined, undefined), {});
  assert.deepEqual(exoPinPatch(null, null), {});
});

test("a runaway reason is capped before it reaches the row", () => {
  const p = exoPinPatch(false, "x".repeat(5000));
  assert.equal(String(p.exoPinError).length, 2000);
});
