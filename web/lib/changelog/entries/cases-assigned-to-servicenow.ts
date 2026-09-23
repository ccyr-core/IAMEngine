import type { ChangelogEntry } from "../format";

export const entry: ChangelogEntry = {
  id: "cases-assigned-to-servicenow",
  date: "2026-09-22",
  time: "16:45",
  title: "Cases: \"Assigned to\" now shows the ServiceNow assignee",
  items: [
    "The Assigned to column on the Cases list now shows who the ServiceNow ticket is assigned to, instead of who opened the case in the app. Who opened it is still in the tooltip",
    "It refreshes from ServiceNow every few minutes, so a ticket picked up or reassigned in ServiceNow shows up here without re-importing the case",
    "A ticket nobody has picked up reads \"unassigned\"; a case with no ServiceNow ticket, or one not read yet, shows a dash (hover to see which)",
    "You can search the list by assignee name or email",
  ],
};
