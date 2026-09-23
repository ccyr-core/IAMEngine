// FR #117: plan `entra` and `m365` as ONE step when a client runs both in the same lane.
//
// They are the same executor — the runner's dispatch table is literally $DISPATCH['entra'] =
// $DISPATCH['m365'] — so a client with both ran the M365 module twice per offboard: block sign-in,
// revoke sessions, strip groups and MFA, then do it all again. Profiles split the lane config between
// them (m365: block sign-in + licence; entra: revoke sessions + app access), so the merged step takes
// the UNION of the two lane configs, m365 winning a conflict.
//
// The one deliberate split was licence timing: `removeLicense: { defer: true, removedBy: "entra" }` on
// the m365 lane (MarketScience) made the licence come off in the later entra step, after Exchange had
// converted the mailbox. The planner now enforces "exchange before m365/entra" on every offboard
// (OFFBOARD safety invariant in orchestrator.ts), so the merged m365 step already runs after the
// conversion — it takes entra's removeLicense instead of deferring to a step that no longer exists.
//
// An entra-only client (no m365 in the lane) is untouched, and cases planned before this keep their jobs.
import type { ClientSystem } from "@prisma/client";

type Lane = "onboard" | "offboard";
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

// Deep merge, `winner` taking precedence on a conflict; arrays are unioned (groups lists etc.).
function mergeInto(loser: unknown, winner: unknown): unknown {
  if (isObj(loser) && isObj(winner)) {
    const out: Obj = { ...loser };
    for (const [k, v] of Object.entries(winner)) out[k] = k in loser ? mergeInto(loser[k], v) : v;
    return out;
  }
  if (Array.isArray(loser) && Array.isArray(winner)) return [...new Set([...loser, ...winner])];
  return winner === undefined ? loser : winner;
}

function mergeLane(m365Lane: unknown, entraLane: unknown): unknown {
  if (entraLane == null) return m365Lane;
  if (m365Lane == null) return entraLane;
  const merged = mergeInto(entraLane, m365Lane) as Obj;
  // Licence timing (see the header): a removal m365 deferred to entra is now entra's to decide.
  const rl = isObj(m365Lane) ? m365Lane.removeLicense : undefined;
  if (isObj(rl) && String(rl.removedBy ?? "") === "entra") {
    const entraRl = isObj(entraLane) ? entraLane.removeLicense : undefined;
    merged.removeLicense = entraRl ?? true;
  }
  return merged;
}

function orMap(a: unknown, b: unknown): Obj | undefined {
  if (!isObj(a) && !isObj(b)) return undefined;
  const out: Obj = {};
  for (const src of [a, b]) if (isObj(src)) for (const [k, v] of Object.entries(src)) out[k] = Boolean(out[k]) || Boolean(v);
  return out;
}

function mergeConfig(m365: unknown, entra: unknown): Obj | null {
  if (!isObj(m365) && !isObj(entra)) return null;
  const m = isObj(m365) ? m365 : {};
  const e = isObj(entra) ? entra : {};
  const out: Obj = { ...(mergeInto(e, m) as Obj) };
  for (const lane of ["onboard", "offboard"] as Lane[]) {
    const v = mergeLane(m[lane], e[lane]);
    if (v === undefined) delete out[lane]; else out[lane] = v;
  }
  // Per-lane flag maps: set if EITHER side set it — merging must never drop an approval or evidence gate.
  for (const key of ["requiresApproval", "captureEvidence"]) {
    const v = orMap(m[key], e[key]);
    if (v) out[key] = v;
  }
  // Intent: destructive on a lane if either side was.
  if (isObj(m.intent) || isObj(e.intent)) {
    const mi = (isObj(m.intent) ? m.intent : {}) as Obj;
    const ei = (isObj(e.intent) ? e.intent : {}) as Obj;
    const intent: Obj = { ...ei, ...mi };
    for (const lane of ["onboard", "offboard"]) if (mi[lane] === "destructive" || ei[lane] === "destructive") intent[lane] = "destructive";
    out.intent = intent;
  }
  return out;
}

const swapEntra = (keys: string[]) => [...new Set(keys.map((k) => (k === "entra" ? "m365" : k)))];

// Returns the active systems with entra folded into m365 (or unchanged when not both present).
export function mergeEntraIntoM365(active: ClientSystem[]): ClientSystem[] {
  const m365 = active.find((s) => s.systemKey === "m365");
  const entra = active.find((s) => s.systemKey === "entra");
  if (!m365 || !entra) return active;
  const mergedConfig = mergeConfig(m365.config, entra.config);
  // The merged step's own deps: both sides', minus the two of them.
  const deps = [...new Set([...m365.dependsOn, ...entra.dependsOn])].filter((d) => d !== "m365" && d !== "entra");
  if (mergedConfig && isObj(mergedConfig.dependsOn)) {
    const lanes: Obj = {};
    for (const [lane, list] of Object.entries(mergedConfig.dependsOn)) {
      lanes[lane] = Array.isArray(list) ? list.map(String).filter((d) => d !== "m365" && d !== "entra") : list;
    }
    mergedConfig.dependsOn = lanes;
  }
  const merged: ClientSystem = {
    ...m365,
    dependsOn: deps,
    requiresApproval: m365.requiresApproval || entra.requiresApproval,
    captureEvidence: m365.captureEvidence || entra.captureEvidence,
    secretNames: [...new Set([...m365.secretNames, ...entra.secretNames])],
    config: mergedConfig as ClientSystem["config"],
  };
  // Everything that waited on entra now waits on the merged m365 step.
  return active
    .filter((s) => s.systemKey !== "entra")
    .map((s) => {
      if (s.systemKey === "m365") return merged;
      const cfg = s.config as Obj | null;
      const laneDeps = isObj(cfg?.dependsOn) ? cfg!.dependsOn as Obj : null;
      const touches = s.dependsOn.includes("entra") || (laneDeps && Object.values(laneDeps).some((l) => Array.isArray(l) && l.includes("entra")));
      if (!touches) return s;
      const nextCfg = laneDeps
        ? { ...cfg, dependsOn: Object.fromEntries(Object.entries(laneDeps).map(([k, l]) => [k, Array.isArray(l) ? swapEntra(l.map(String)) : l])) }
        : cfg;
      return { ...s, dependsOn: swapEntra(s.dependsOn), config: nextCfg as ClientSystem["config"] };
    });
}
