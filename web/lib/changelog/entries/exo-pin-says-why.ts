import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "exo-pin-says-why",
  date: "2026-09-11",
  time: "14:00",
  title: "Exchange steps stop failing silently because a module pin never installed",
  items: [
    "Every Exchange step on the central runner was failing with \"does not contain a method named 'GetResponseHeader'\" — the symptom of ExchangeOnlineManagement 3.10.0, whose REST calls use a method PowerShell 7.6 removed. The runner pins the known-good 3.9.2 and installs it at startup for exactly this reason (UM0031200)",
    "The install never worked. It ran inside the runner's own process, which by then has a dozen modules loaded, and PowerShell refuses to install a module while its package manager is in use — \"The version '1.4.8.1' of module 'PackageManagement' is currently in use\". It failed at every single startup, then fell back to the broken build",
    "Nobody could see it, because the runner said so through a channel that does not exist on a Windows host: a warning written to a console the scheduled task never attaches. The self-heal built to prevent this failure had never once worked there, and there was no way to tell",
    "The install now runs in a clean, separate process, so the package manager is not in use and it can actually succeed",
    "When it still cannot, the runner reports the reason on its next check-in and the Agents page shows it on that runner's row — naming the build it will load instead, which is the fact that decides whether Exchange works at all. It clears itself once the pin is in place",
    "Runner 1.122.0 needs deploy",
  ],
};
