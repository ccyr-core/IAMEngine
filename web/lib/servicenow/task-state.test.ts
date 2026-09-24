import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTaskState, fetchTaskStates } from "./task-state";

test("resolved/closed/complete states count as done", () => {
  assert.equal(classifyTaskState("Resolved"), "done");
  assert.equal(classifyTaskState("Closed"), "done");
  assert.equal(classifyTaskState("Closed Complete"), "done");
});

test("cancelled never counts as done — even 'Closed Cancelled'", () => {
  assert.equal(classifyTaskState("Cancelled"), "cancelled");
  assert.equal(classifyTaskState("Closed Cancelled"), "cancelled");
});

test("closed-without-doing-the-work states are NOT done", () => {
  assert.equal(classifyTaskState("Closed Incomplete"), "cancelled");
  assert.equal(classifyTaskState("Closed Skipped"), "cancelled");
});

test("working states stay open", () => {
  assert.equal(classifyTaskState("New"), "open");
  assert.equal(classifyTaskState("In Progress"), "open");
  assert.equal(classifyTaskState("On Hold"), "open");
});

// FR #0000045: the batch read also carries the ticket's assignee for the Cases "Assigned to" column.

const cfg = { instanceUrl: "https://example.service-now.com", username: "u", password: "p" };
function fakeFetch(result: unknown[], seen: string[] = []) {
  return (async (url: string) => {
    seen.push(url);
    return new Response(JSON.stringify({ result }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
}

test("fetchTaskStates reads assigned_to and its dot-walked email", async () => {
  const seen: string[] = [];
  const states = await fetchTaskStates(cfg, ["UM0029001"], fakeFetch([
    { number: { display_value: "UM0029001" }, state: { display_value: "Work in Progress" }, assigned_to: { display_value: "Jane Doe", value: "abc" }, "assigned_to.email": { display_value: "jane@core.tech" } },
  ], seen));
  const s = states.get("UM0029001");
  assert.equal(s?.assignedTo, "Jane Doe");
  assert.equal(s?.assignedToEmail, "jane@core.tech");
  assert.match(decodeURIComponent(seen[0]), /sysparm_fields=[^&]*assigned_to\.email/);
});

test("an unassigned ticket (empty reference) reads as null, not an empty string", async () => {
  const states = await fetchTaskStates(cfg, ["UM0029002"], fakeFetch([
    { number: { display_value: "UM0029002" }, state: { display_value: "New" }, assigned_to: { display_value: "", value: "" }, "assigned_to.email": { display_value: "" } },
  ]));
  const s = states.get("UM0029002");
  assert.equal(s?.assignedTo, null);
  assert.equal(s?.assignedToEmail, null);
});
