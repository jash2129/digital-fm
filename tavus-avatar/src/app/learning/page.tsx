"use client";

import React, { useCallback, useEffect, useState } from "react";
import type { LearningReport } from "@/lib/learning-report";
import type { LearnedSettings } from "@/lib/learned-settings";
import type { Rephrasing } from "@/lib/learned-phrasing";

// What Max has learned: from TXM's coaching (rewordings, timing) and from all calls (the nightly
// report). Nothing here needs approval; it is for seeing what changed and undoing a bad change.

const LABELS: Record<string, string> = {
  endOfTurnExtraMs: "Extra wait before Max replies",
  continuePauseMs: "Pause between parts of the explanation",
};
const when = (ms: number | string) => new Date(ms).toLocaleString();

export default function LearningPage() {
  const [report, setReport] = useState<LearningReport | null>(null);
  const [settings, setSettings] = useState<LearnedSettings | null>(null);
  const [rephrasings, setRephrasings] = useState<Rephrasing[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    const res = await fetch("/api/learning/report");
    if (res.status === 401) return setError("Sign in on the call page first (the demo token), then reload this page.");
    if (!res.ok) return setError(`Could not load (${res.status}).`);
    const data = await res.json();
    setReport(data.report);
    setSettings(data.settings);
    setRephrasings(data.rephrasings ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (action: string) => {
    setBusy(true);
    try {
      await fetch("/api/learning/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const removeRewording = async (id: string) => {
    if (!confirm("Remove this rewording? Max goes back to the original words.")) return;
    await fetch(`/api/learned?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 px-4 py-8 sm:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">What Max has learned</h1>
            <p className="text-sm text-slate-400">From TXM&apos;s coaching in calls and from every call&apos;s signals. Changes apply at once; undo any of them here.</p>
          </div>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => post("run")} className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-sm font-semibold">
              {busy ? "Working…" : "Learn from new calls now"}
            </button>
            <a href="/inspector" className="px-3 py-2 rounded-lg border border-slate-700 text-sm">Inspector</a>
          </div>
        </header>

        {error && <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm">{error}</div>}

        <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <h2 className="font-semibold">Rewordings from coaching ({rephrasings.length})</h2>
          {rephrasings.length === 0 ? (
            <p className="text-sm text-slate-400">None yet. In a call: &quot;Coach mode&quot;, &quot;instead of X, say Y&quot;, &quot;done&quot;.</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {rephrasings.map((r) => (
                <li key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    <span className="text-slate-400">&quot;{r.from}&quot;</span> → <span className="text-emerald-300">{r.to ? `"${r.to}"` : "(left out)"}</span>
                    <span className="text-slate-500"> · Beat {r.beat ?? "?"} · {when(r.createdAt)}</span>
                  </span>
                  <button onClick={() => removeRewording(r.id)} className="text-xs px-2 py-1 rounded border border-slate-700 hover:border-red-500 hover:text-red-300">Remove</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Timing Max tuned</h2>
            <button disabled={busy} onClick={() => confirm("Put the timing back to the defaults?") && post("reset-settings")} className="text-xs px-2 py-1 rounded border border-slate-700">Reset to defaults</button>
          </div>
          {settings && (
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">{LABELS.endOfTurnExtraMs}: <b>{settings.endOfTurnExtraMs} ms</b></div>
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">{LABELS.continuePauseMs}: <b>{(settings.continuePauseMs / 1000).toFixed(1)} s</b></div>
            </div>
          )}
          {settings && settings.history.length > 0 && (
            <ul className="text-xs text-slate-400 space-y-1">
              {[...settings.history].reverse().slice(0, 15).map((h, i) => (
                <li key={i}>
                  {when(h.at)} · {LABELS[h.key]}: {h.from} → {h.to} · <span className="uppercase">{h.source}</span> · {h.reason}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <h2 className="font-semibold">Latest learning report {report && <span className="text-slate-400 font-normal text-sm">· {when(report.generatedAt)} · {report.newCalls} new call(s)</span>}</h2>
          {!report ? (
            <p className="text-sm text-slate-400">No report yet. It runs every night, or press &quot;Learn from new calls now&quot;.</p>
          ) : (
            <>
              <ul className="list-disc pl-5 text-sm space-y-1">
                {report.findings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
              {report.actions.length > 0 && (
                <div className="text-sm text-emerald-300">
                  Changed on its own: {report.actions.map((a) => `${LABELS[a.key]} ${a.from} → ${a.to}`).join("; ")}
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {[
                  ["Calls", report.totals.calls],
                  ["Finished the script", report.totals.completed],
                  ["Avg customer turns", report.totals.avgTurns],
                  ["Cut off mid-sentence", report.totals.cutOffs],
                  ["Interruptions", report.totals.bargeIns],
                  ["No customer turns", report.totals.zeroTurnCalls],
                  ["Avg reply time", report.totals.avgLatencyMs ? `${(report.totals.avgLatencyMs / 1000).toFixed(1)} s` : "–"],
                  ["Slowest 10%", report.totals.p90LatencyMs ? `${(report.totals.p90LatencyMs / 1000).toFixed(1)} s` : "–"],
                ].map(([k, v]) => (
                  <div key={String(k)} className="p-2 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="text-slate-400">{k}</div>
                    <div className="text-lg font-semibold">{v}</div>
                  </div>
                ))}
              </div>
              {report.unanswered.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-1">Questions Max could not answer (need an approved answer)</h3>
                  <ul className="text-sm text-slate-300 space-y-1">
                    {report.unanswered.map((u, i) => (
                      <li key={i}>
                        &quot;{u.question}&quot; <span className="text-slate-500">· Beat {u.beat} · {u.count}x</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {Object.keys(report.byBeat).length > 0 && (
                <div className="overflow-x-auto">
                  <h3 className="text-sm font-semibold mb-1">By beat</h3>
                  <table className="text-xs w-full">
                    <thead className="text-slate-400">
                      <tr>
                        {["Beat", "Repeat asked", "Confused", "Unclear", "Unanswered", "Calls stopped here"].map((h) => (
                          <th key={h} className="text-left p-1">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(report.byBeat)
                        .sort((a, b) => Number(a[0]) - Number(b[0]))
                        .map(([b, r]) => (
                          <tr key={b} className="border-t border-slate-800">
                            <td className="p-1">{b === "0" ? "Step 0" : b}</td>
                            <td className="p-1">{r.repeats}</td>
                            <td className="p-1">{r.confusion}</td>
                            <td className="p-1">{r.unclear}</td>
                            <td className="p-1">{r.unanswered}</td>
                            <td className="p-1">{r.endedHere}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
              {report.coaching.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-1">Coaching notes in these calls</h3>
                  <ul className="text-sm space-y-1">
                    {report.coaching.map((c, i) => (
                      <li key={i}>
                        <span className="text-slate-500">Beat {c.beat} · </span>
                        {c.note}
                        {c.applied && <span className="text-emerald-300"> · applied: &quot;{c.applied.from}&quot; → {c.applied.to ? `"${c.applied.to}"` : "(left out)"}</span>}
                        {c.settings?.length ? <span className="text-emerald-300"> · timing: {c.settings.join(", ")}</span> : null}
                        {c.notApplied && <span className="text-amber-300"> · not applied: {c.notApplied}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
