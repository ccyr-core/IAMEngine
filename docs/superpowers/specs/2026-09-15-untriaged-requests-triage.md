# Triage: the nineteen requests never ranked, and three the last two days already fixed

**Scope:** every open request with status `new` — #45, #80, #116–#119, #122–#125, #127, #128, #131–#134,
#137, #170–#173. The 2026-09-03 triage covered #106–#115 and nothing since. Eighteen of the nineteen were
filed by `ccyr@core.tech` from live case pages between 2026-07-28 and 2026-09-15.

Ranked on the same scale the previous two specs used: silently-wrong results first, then operator-blocking
failures, then correctness gaps, then convenience. Claims are checked against the code; where a request
needs diagnosis before it can be ranked honestly, it says so rather than guessing.

**Three of these are already fixed** by the 2026-09-14/15 runner work and should be closed, not built.

## Tier 0 — close these, the work is done

### #172 — Central Runner CORE DC using incorrect Exchange Module

> "I was able to get a test computer to work with just the 3.9.2 ExchangeOnline Module that doesn't throw
> the header error … `Install-PSResource -Name ExchangeOnlineManagement -Version 3.9.2 -scope allusers`"

The requester independently found the same fix and the same scope. ExchangeOnlineManagement 3.10.0's REST
cmdlets call `HttpResponseMessage.GetResponseHeader()`, removed in PS7.6. Fixed on the host (3.9.2 AllUsers)
and in the code: `Install-CtgExoPin` now installs in a clean child process, because it was calling
`Install-Module` inside the runner where PowerShellGet refuses while PackageManagement is loaded — so the
self-heal built to prevent exactly this had failed at every startup since it was written, silently.
**Resolve with a note naming runner 1.122.0.**

### #137 — Connection Test Failed for Exchange

> "Method invocation failed because [System.Net.Http.HttpResponseMessage] does not contain a method named
> 'GetResponseHeader'."

Same root cause as #172, seen through the connection test on core1069 instead of a case. Same fix.
**Resolve, referencing #172.**

### #125 — Offboarding for Brighton Park Capital with the Exchange Module

> "[exchange] while missing command 'Get-MailboxStatistics' — locating + installing its module: The term
> 'Get-MailboxStatistics' is not recognized…"

The *other* face of the same failure: not a broken cmdlet but no importable EXO module at all, so the
missing-command self-heal tried to install one and could not. Same family, same host, same fix — but this
one is worth **verifying against a re-run before closing**, because "module absent" and "module present but
broken" are different states and only the second is proven fixed.

## Tier 1 — silently wrong on live cases

### 1. #116 — OneDrive delegation does not work

> "The current OneDrive delegation is not working, and needs to function by adding Delegates as a Site
> Collection Admin, rather than the current method that is failing."

This is a leaver's data never reaching the person who needs it, and the case does not say so. It outranks
everything else open. Note it is **not** what FR #120 fixed — that made site access reach every delegate
rather than a merged one; this says the mechanism itself fails. Two sub-asks ride along: which permissions
each client's app registration needs (so one credential shape works fleet-wide), and detecting the tenant's
OneDrive subdomain prefix automatically. Needs diagnosis before design: what does the current grant actually
return, and is it a permission gap or the wrong API.

### 2. #131 (+ #108) — the manager is carried as a NAME, and ServiceNow truncates it

> "Should be grabbing the user's main email rather than the username in SNOW since that has a character limit."

**Confirmed in code, and it is one line.** `intake-mapper.ts:209` already resolves `managerEmail` from
`customer_contact` — the comment even says "preferred for 365 lookup". But `lib/profiles/context.ts:74`
passes `manager: s("managerName") ?? s("manager")`, the readable name, which is the field ServiceNow
truncates. So the resolved email is captured and then not used.

This is the **onboarding half of #108**, which the 2026-09-03 triage ranked Tier 1 as "a truncated username
still looks valid, so the offboard proceeds against the wrong address and reports green either way". Same
root cause, same field family as #97's `forwardEmailTo`. They should be built together.

Cheapest high-value fix open. Prefer the email, keep the name as the fallback and as the display value.

### 3. #132 — Zoom assigns a license the profile explicitly said not to

> "Onboarding tries to add a user with a license even though I've specified in the .json file that they are
> to get Type 1 with no license."

The module reads it correctly — `Coretelligent.Zoom.psm1:195`, `$desiredType = [int]((Get-CtgProp $Config
'type') ?? 2)`, defaulting to 2 = Licensed. So the value is either not reaching `$Config` from the client
profile, or is under a different key. That is the **captured-and-dropped shape for the fifth time** (#47,
#84, #97, #115), and it costs money every time it fires: a Pro seat assigned against explicit instruction.
Verify the profile → `ClientSystem.config` → job-config path before designing.

### 4. #133 — a missing licence warns instead of failing

> "Rather than showing a Warning, Microsoft 365 should fail if a license isn't available during an
> Onboarding to prevent further steps from being completed."

Correct, and the reasoning is the requester's own: an unlicensed account cannot have a mailbox, so every
downstream step is operating on something that does not exist yet, and the case still reports green. Same
shape as the offboard licence work in #95. Small and well understood.

### 5. #170 — the MFA-removal warning blames permissions that are already correct

> "This error appears on a lot of different cases, even ones with the correct permission attached."

The warning names two causes (missing `UserAuthenticationMethod.ReadWrite.All`, or a cached token predating
consent) and sends the operator to re-grant an app registration that is already right. This is the **third**
instance of the hint-lying shape, after #130 and the browser-install hint fixed on 2026-09-15. Diagnose what
the Graph call actually returns before touching the message — if methods genuinely are not being removed,
the warning is true and the bug is elsewhere, which would move this to Tier 0.

## Tier 2 — the engine fights itself

### 6. #127 — Entra Connect reports success it has not earned

> "The system appears to be only showing success when the system itself is successful and doesn't throw any
> errors. I reran … multiple times without success, but remoted into the server and ran the command, and
> then it finally synced. The system is also not reporting when a sync is in progress."

Partly addressed: FR #112 (runner 1.113.0) made the directory-sync step wait for the sync to finish rather
than firing and returning. This asks for two further things — that "no error" stop counting as "synced", and
that a sync already in progress be reported rather than looking idle. **Re-test on the current build first**;
the filing predates #112 shipping by five days.

### 7. #171 — the runner script fails when PowerShell came from the Store

> "New-Item: Access to the path 'C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.6.0_x64…\Scripts' is
> denied." … "I edited the script to move the current directory to another, writable place, and it worked"

A relative path resolving against the process's working directory, which for a Store-installed pwsh is the
read-only `WindowsApps` package folder. Cheap to fix and cheap to get wrong: the answer is to anchor the
path on `$PSScriptRoot`, not to document a `cd`. Worth finding every relative write in the script at the
same time rather than patching the one that surfaced.

## Tier 3 — capability gaps, well specified

These are new behaviour rather than broken behaviour. Ordered by how often the operator hits them.

- **#134 — disable a step on a single case.** "Some onboardings … may be just email steps." Today the plan is
  all-or-nothing per client. High friction, asked for repeatedly in different words (#128, #173 are cousins).
- **#173 — "On Request" steps.** The runner has no way to know a step was requested rather than standard.
  Pairs with #134; design them together or the case surface grows two similar controls.
- **#128 — per-case destructive vs disable.** Client policy is per-client today; this asks for a per-case
  override. Note this touches the `requiresApproval` gate, so it needs care about who may choose.
- **#119 — exclude groups from mirroring (LogicSource).** "Only security groups mirrored … the ChatGPT group
  excluded." A filter list on the mirror, per client. Concrete and contained.
- **#118 — SharePoint module: remove from SP groups on offboard, mirror them on onboard.** Real gap; pairs
  naturally with #116's SharePoint work.
- **#124 — TAP module visible only for Coretelligent.** Wanted for password-less builds. Likely a gating flag
  rather than new capability — check why it is client-scoped before estimating.
- **#122 — split "Depends On" into onboard and offboard.** Modelling fix; the two genuinely differ.
- **#117 — M365 and Entra systems run identical steps.** Architectural, and the requester's own conclusion
  ("the Entra system may need to be removed completely") deserves a design pass, not a patch. Largest item
  here; do not start it between smaller ones.
- **#80 — Google backbone should set passwords in Google, not 365.** Correctness for one backbone; narrow.

## Tier 4 — convenience

- **#123 — Cases view: Subject should be just the user's name; move Action and date columns left.**
- **#45 — Cases: an "Assigned to" column.** Pairs with #123; do them in one pass.
- **#110 — Cases page width** (already ranked lowest on 2026-09-03).
- **#98, #43, #102, #103, #81, #86, #88** — carried from the previous queue, unchanged.

## The merged queue

1. **#116** — OneDrive delegation fails (leaver data handoff)
2. **#131 + #108** — manager/username truncated; email already resolved and unused
3. **#132** — Zoom licence assigned against config (5th captured-and-dropped)
4. **#133** — missing licence warns instead of failing
5. **#170** — MFA warning blames the wrong thing (diagnose first)
6. **#127** — Entra Connect false success (re-test on current build first)
7. **#171** — runner script's relative path under Store PowerShell
8. **#113** — AD writeback detection (carried, Tier 2 in the 2026-09-03 spec)
9. **#103, #102** — small, already ranked
10. **#114** — password alphabet
11. **#134 + #173 + #128** — per-case step control, designed together
12. **#119, #118, #124, #122** — contained capability gaps
13. **#117** — M365/Entra overlap (design pass, not a patch)
14. **#88, #81, #86, #80** — capability, as before
15. **#106** — unattended chat announce. The 2026-09-03 blocker was the chat transport returning HTTP 400;
    the Zoom announce fix shipped 2026-09-10, so **re-check whether this is still blocked** before ranking it
    low again.
16. **#123, #45, #110, #43, #98** — convenience

## What this changes

Two things are worth saying plainly.

**The top of the old queue has moved.** #108 was ranked fourth on 2026-09-03 and is now second, because #131
arrived as its onboarding twin and because the fix turned out to be one line against a value the mapper
already resolves. It should be built next after #116, and both halves together.

**The reporting bugs have a pattern.** #172, #137, #170, #127 and the browser-install and EXO-pin failures
fixed on 2026-09-14/15 are all the same defect: the engine knew what was wrong and said it somewhere nobody
reads, or said something untrue. Five of the last seven production issues were failures of *reporting*, not
of execution. That is worth treating as a theme rather than as six separate tickets — the next one will
also be a reporting bug.

## Corrections to this spec, made while building from it

- **#108 does NOT pair with #131.** Ranked second here on the assumption they share a root cause. They
  do not. The offboard has resolved the leaver by email since `b3495481` (2026-07-14), a month before
  #108 was filed on 2026-08-18, and the reported case UM0030657 stored
  `userPrincipalName: calin.meserschmidt@puretechscientific.com` — full, untruncated — and completed.
  Whatever the requester saw truncated is not what the engine consumed. #108 stays open and unbuilt:
  it needs a case that actually failed, not a fix aimed at a symptom that does not reproduce. #131 was
  built alone (PR #85).

  Worth noting *why* the pairing looked right: both quote a ServiceNow field with a character limit,
  and #131's fix is exactly the one #108 would have needed. Shared symptom, different code path — the
  offboard path had already been fixed and the onboard path never was.

- **#172 and #137 are closed** (resolved 2026-09-15, runner 1.122.0). **#125 was left open** pending a
  re-run, for the reason given above: "module absent" and "module present but broken" are different
  states and only the second is proven fixed.
