"use client";

// Per-case offboard actions (FR #128): for this one offboard, choose delete vs suspend (Google), delete vs
// convert the mailbox (Exchange), remove vs archive the licence (Spanning). Saves through the case fields
// route as payload.offboardActions (operator-sourced, so a ServiceNow re-pull keeps it) and re-plans.
// A delete/remove choice makes that step approval-gated with an evidence snapshot.
import { useState } from "react";
import { useRouter } from "next/navigation";

export type OffboardActionRow = {
  systemKey: "google-workspace" | "exchange" | "spanning";
  current: string; // the choice the plan carries now
  locked: boolean; // the step already ran on this case
};

const OPTIONS: Record<OffboardActionRow["systemKey"], { label: string; keep: [string, string]; destroy: [string, string] }> = {
  "google-workspace": { label: "Google account", keep: ["suspend", "Suspend (default)"], destroy: ["delete", "Delete — restorable for 20 days"] },
  exchange: { label: "Mailbox", keep: ["convert", "Convert to shared (keeps the mail)"], destroy: ["delete", "Delete — purged 30 days after the licence comes off"] },
  spanning: { label: "Spanning licence", keep: ["archive", "Archive (keeps the backup)"], destroy: ["remove", "Remove — frees the seat"] },
};

export function OffboardActionsControl({ caseId, rows, canEdit }: { caseId: string; rows: OffboardActionRow[]; canEdit: boolean }) {
  const router = useRouter();
  const initial = Object.fromEntries(rows.map((r) => [r.systemKey, r.current]));
  const [choice, setChoice] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = rows.some((r) => choice[r.systemKey] !== r.current);
  const destroying = rows.filter((r) => choice[r.systemKey] === OPTIONS[r.systemKey].destroy[0]);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/cases/${caseId}/fields`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: { offboardActions: choice } }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ ok: false, text: d.error ?? `failed (${r.status})` }); return; }
      // The fields route only re-plans a case nothing has run on; re-plan explicitly otherwise (it keeps
      // every step that ran).
      if (d.replanned == null) {
        const rp = await fetch(`/api/cases/${caseId}/replan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (!rp.ok) { const e = await rp.json().catch(() => ({})); setMsg({ ok: false, text: `saved, but the re-plan failed: ${e.error ?? rp.status} — use Re-plan in the Actions menu` }); router.refresh(); return; }
      }
      setMsg({ ok: true, text: "Saved — the case was re-planned." });
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ margin: "0.4rem 0" }}>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        {rows.map((r) => {
          const o = OPTIONS[r.systemKey];
          return (
            <label key={r.systemKey} className="note" style={{ display: "flex", flexDirection: "column", gap: 3, margin: 0 }}>
              <span>{o.label}{r.locked ? " — already ran" : ""}</span>
              <select value={choice[r.systemKey]} disabled={!canEdit || busy || r.locked} onChange={(e) => { setChoice((c) => ({ ...c, [r.systemKey]: e.target.value })); setMsg(null); }}>
                <option value={o.keep[0]}>{o.keep[1]}</option>
                <option value={o.destroy[0]}>{o.destroy[1]}</option>
              </select>
            </label>
          );
        })}
        {canEdit && <button className="primary" disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : "Save and re-plan"}</button>}
      </div>
      {destroying.length > 0 && (
        <p className="note" style={{ color: "#b3261e", margin: "0.35rem 0 0" }}>
          {destroying.map((r) => OPTIONS[r.systemKey].label).join(", ")}: deleting needs approval on the case before it runs, and the current state is snapshotted first.
        </p>
      )}
      {msg && <p className="note" style={{ color: msg.ok ? undefined : "#b3261e", margin: "0.35rem 0 0" }}>{msg.text}</p>}
    </div>
  );
}
