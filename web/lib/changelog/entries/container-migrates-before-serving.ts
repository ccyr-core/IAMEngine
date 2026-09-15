import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "container-migrates-before-serving",
  date: "2026-09-14",
  time: "16:00",
  title: "A release can no longer go live ahead of its own database change",
  items: [
    "Merging to main is the deploy here — the push builds the image and ships it. Nothing in that path ever touched the database, so a release whose code read a new column went live against a database that did not have it yet, and the migration was a separate step someone had to remember",
    "When that is missed it is not a broken feature, it is an outage: the database layer asks for every column of a table in one go, so one missing column takes down every page that touches it. That happened on 2026-09-14 — the Agents page threw on every load until the migration was applied by hand",
    "The container now applies pending migrations before it starts serving, so the schema is always at least as new as the code that needs it",
    "If a migration fails the container stops rather than starting anyway, and the previous release keeps serving traffic — a deploy that cannot migrate now fails visibly instead of half-landing",
  ],
};
