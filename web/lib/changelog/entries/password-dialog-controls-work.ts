import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "password-dialog-controls-work",
  date: "2026-09-22",
  time: "16:00",
  title: "Set / generate password on a Run Report step: the dialog's options now respond",
  items: [
    "On a Run Report step, \"Enter a specific password\" and the \"require change at next sign-in\" checkbox could not be changed - every click in the dialog also reached the step row behind it, which cancelled the click. Both now work, so a specific password can be set and the forced change can be turned off for equipment setup",
    "Clicking inside the dialog no longer expands or collapses the step behind it",
  ],
};
