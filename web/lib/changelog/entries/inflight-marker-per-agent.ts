import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "inflight-marker-per-agent",
  date: "2026-09-11",
  time: "18:00",
  title: "A second runner in the same folder can no longer declare the first one's job dead",
  items: [
    "When a runner dies mid-step it leaves a marker on disk so the next start can report that step as failed with a real reason, rather than leaving it at \"running\" until its lease expires half an hour later",
    "That marker was one fixed filename for the whole folder. A runner's lock and heartbeat are both named after the agent; this was not — so a second runner started in the same directory read the FIRST one's marker at startup and reported its live, still-running job to the app as failed, then deleted the marker. On the central runner the same job was declared dead on three separate days while it was actually running",
    "The marker is now named after the agent, so two runners sharing a folder each keep their own and neither can touch the other's",
    "It is also now a hidden file, which fixes a second problem nobody had connected to it: the runner's \"am I up to date?\" check hashes the files in its folder, and this one counted. A runner that died mid-step came back with a marker on disk, computed a build the app can never match, and was told to update itself — every time, forever. Each of those updates exits the runner process",
    "And a third: the self-update used to delete the marker, so a step abandoned just before an update was never reported at all. It now survives",
    "A leftover marker from an older runner is cleaned up on the next start. It is deliberately not reported — the old file records no agent, so on the very host this fixes there is no way to tell whether it belongs to this runner or to one still running that step",
    "Runner 1.123.0 needs deploy",
  ],
};
