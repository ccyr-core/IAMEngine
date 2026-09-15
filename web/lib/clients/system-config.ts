// Validate a ClientSystem.config before it is stored.
//
// The PUT route sanitizes every other field — mode, lanes, dependsOn, the booleans — and then passes
// `config` through untouched as `o.config ?? null`. That is how core2272's zoom system came to hold
//
//     { "intent": { "onboard": { "type": 1 }, "offboard": "disable" } }
//
// with the onboard block nested INSIDE intent. `intent` carries exactly one thing: the offboard
// disable/destructive classification (systems-editor.tsx:299 writes only intent.offboard, and every
// other client reads {"offboard":"disable"}). Step config belongs at the top level, as core519's
// working {"onboard":{"type":1}} shows.
//
// Nothing reads intent.onboard, so Coretelligent.Zoom.psm1:195 fell through to its `?? 2` default —
// Licensed — and bought a Pro seat on every onboard for a client who had explicitly asked for Basic.
// The config was accepted in silence and ignored in silence, and the only signal was the bill.
//
// This refuses rather than repairs. Moving the block automatically would mean guessing that the
// operator meant `config.onboard`, and a config that quietly becomes something else is the same class
// of problem in a friendlier costume. The message names the key and where it belongs.
//
// Scope is deliberately narrow: `intent` has a known, tiny vocabulary, so an unknown key there is
// certainly wrong. Per-system config under `onboard`/`offboard` varies by module and is NOT policed
// here — that would reject valid shapes nobody has catalogued.

// The only key `intent` carries, and the only values the offboard classification takes.
const INTENT_KEYS = ["offboard"] as const;
const OFFBOARD_INTENTS = ["disable", "destructive"] as const;

/**
 * Returns null when the config is storable, or an operator-facing message explaining what is wrong.
 * A message is a 422, not a warning: the whole failure mode being closed is a config that is accepted
 * and then never read.
 */
export function validateSystemConfig(config: unknown): string | null {
  if (config == null) return null;
  if (typeof config !== "object" || Array.isArray(config)) return "config must be an object";

  const c = config as Record<string, unknown>;
  if (!("intent" in c) || c.intent == null) return null;

  const intent = c.intent;
  if (typeof intent !== "object" || Array.isArray(intent)) {
    return `config.intent must be an object like { "offboard": "disable" } — got ${Array.isArray(intent) ? "an array" : typeof intent}`;
  }

  const i = intent as Record<string, unknown>;
  for (const key of Object.keys(i)) {
    if ((INTENT_KEYS as readonly string[]).includes(key)) continue;
    // The one that cost money, called out by name: it is the mistake anyone would make.
    if (key === "onboard" || key === "offboard") {
      return `config.intent.${key} is never read — step configuration belongs at the top level, as config.${key}. config.intent carries only the offboard classification ("disable" or "destructive").`;
    }
    return `config.intent.${key} is never read — config.intent carries only ${INTENT_KEYS.join(", ")}. Did you mean config.${key}?`;
  }

  if ("offboard" in i && !(OFFBOARD_INTENTS as readonly string[]).includes(String(i.offboard))) {
    return `config.intent.offboard must be "disable" or "destructive" — got ${JSON.stringify(i.offboard)}`;
  }

  return null;
}
