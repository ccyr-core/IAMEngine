import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "system-config-intent-guard",
  date: "2026-09-15",
  time: "18:00",
  title: "A system setting saved in the wrong place is now refused, instead of quietly ignored",
  items: [
    "A client had asked for Zoom accounts with no licence. The setting was saved one level too deep — inside the offboard-classification block rather than alongside it — so nothing ever read it, and every onboarding fell back to the default and bought a paid seat (FR #0000132)",
    "Nothing said so. The setting was accepted without complaint, ignored without complaint, and the only evidence was the invoice",
    "Saving a system now refuses a setting placed where nothing reads it, and the message names the setting and where it belongs. It refuses rather than moving it for you — a setting that quietly becomes something else is the same problem wearing a friendlier face",
    "The one client affected has been corrected, and their Zoom accounts will be created unlicensed as asked. No other client had a setting in the wrong place",
  ],
};
