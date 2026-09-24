// Look up the live state of any ServiceNow task-derived record (PC procurement cases, UMs, …) by
// its number. The `task` table spans every task type, so this works without knowing the record's
// concrete table. Display values so the state is the human label ("Resolved"), not a code.
import type { SnConfig } from "./types";
import { snGet } from "./http";

// assignedTo / assignedToEmail: the ticket's `assigned_to` user (display name) and that user's email
// (dot-walked), both null when the ticket is unassigned. FR #0000045 mirrors them onto the case.
export type TaskState = { number: string; state: string; sysClassName: string; assignedTo: string | null; assignedToEmail: string | null } | null;

type Fetcher = typeof fetch;
type Field = { display_value?: string };
type TaskRow = { number?: Field; state?: Field; sys_class_name?: Field; assigned_to?: Field; "assigned_to.email"?: Field };

const FIELDS = "number,state,sys_class_name,assigned_to,assigned_to.email";

// An unassigned reference comes back as an empty display value, not a missing key — both mean "nobody".
function orNull(f: Field | undefined): string | null {
  const v = f?.display_value?.trim();
  return v ? v : null;
}

function toTaskState(r: TaskRow, number: string): NonNullable<TaskState> {
  return {
    number,
    state: r.state?.display_value ?? "",
    sysClassName: r.sys_class_name?.display_value ?? "",
    assignedTo: orNull(r.assigned_to),
    assignedToEmail: orNull(r["assigned_to.email"]),
  };
}

export async function fetchTaskState(config: SnConfig, number: string, fetcher: Fetcher = fetch): Promise<TaskState> {
  const rows = await snGet<TaskRow[]>(
    config,
    "/api/now/table/task",
    {
      sysparm_query: `number=${number}`,
      sysparm_fields: FIELDS,
      sysparm_display_value: "all",
      sysparm_limit: "1",
    },
    fetcher
  );
  const r = rows[0];
  if (!r) return null;
  return toTaskState(r, r.number?.display_value ?? number);
}

// Batch lookup: the states of many task numbers in one query per chunk (`numberIN<a>,<b>,…`), keyed
// by number. Numbers that don't match the record-number shape (defense against query injection —
// same rule as resolveUmSysId) or that SN doesn't know are simply absent from the map.
const NUMBER_RE = /^[A-Za-z]{2,6}\d{5,}$/;
const CHUNK = 50; // keep the sysparm_query comfortably under URL-length limits

export async function fetchTaskStates(config: SnConfig, numbers: string[], fetcher: Fetcher = fetch): Promise<Map<string, NonNullable<TaskState>>> {
  const valid = numbers.filter((n) => NUMBER_RE.test(n));
  const out = new Map<string, NonNullable<TaskState>>();
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK);
    const rows = await snGet<TaskRow[]>(
      config,
      "/api/now/table/task",
      {
        sysparm_query: `numberIN${chunk.join(",")}`,
        sysparm_fields: FIELDS,
        sysparm_display_value: "all",
        sysparm_limit: String(chunk.length),
      },
      fetcher
    );
    for (const r of rows) {
      const number = r.number?.display_value;
      if (!number) continue;
      out.set(number, toTaskState(r, number));
    }
  }
  return out;
}

// Classify a task state label. "Cancelled" / "Closed Incomplete" / "Closed Skipped" must NOT count
// as done — those closures mean the work (the license purchase) did NOT happen, so the blocked
// step must not auto-re-run. Only an affirmative resolution counts.
export function classifyTaskState(state: string): "open" | "done" | "cancelled" {
  if (/cancel|incomplete|skip/i.test(state)) return "cancelled";
  if (/resolv|closed|complete/i.test(state)) return "done";
  return "open";
}
