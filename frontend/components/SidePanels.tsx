"use client";

import { useMemo, useState } from "react";
import { Search, ShieldCheck } from "lucide-react";
import { formatGen, wei } from "@/lib/contracts/types";
import { useRegistry } from "@/lib/hooks/usePatchPledge";
import { Input } from "./ui/input";

export function StatsPanel() {
  const { pledges, claims } = useRegistry();
  const active = pledges.filter((p) => p.state === "active");
  const bonded = active.reduce((t, p) => t + wei(p.bond), 0n);
  const paid = pledges.reduce((t, p) => t + wei(p.total_paid), 0n);
  const breaches = claims.filter((c) => c.outcome === "paid").length;
  const open = claims.filter((c) => c.state === "pending").length;
  const tiles = [
    { label: "GEN bonded", value: formatGen(bonded, 1) },
    { label: "active pledges", value: String(active.length) },
    { label: "breaches paid", value: `${breaches} · ${formatGen(paid, 1)} GEN` },
    { label: "claims open", value: String(open) },
  ];
  return (
    <div className="brand-card p-5">
      <h3 className="text-lg font-bold mb-3">At a glance</h3>
      <dl className="grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg bg-muted/60 p-3">
            <dd className="text-xl font-bold">{t.value}</dd>
            <dt className="text-xs text-muted-foreground">{t.label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Is a package covered? The same question `covered_by` answers on-chain, from the cached registry. */
export function PackageLookup() {
  const { pledges } = useRegistry();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const hits = useMemo(
    () => (needle ? pledges.filter((p) => p.state === "active" && p.package.toLowerCase().replace(/[-_.]+/g, "-") === needle.replace(/[-_.]+/g, "-")) : []),
    [pledges, needle]
  );
  return (
    <div className="brand-card p-5 space-y-3">
      <h3 className="text-lg font-bold flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-primary" />
        Is my dependency covered?
      </h3>
      <div className="relative">
        <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="package name, e.g. next" className="pl-8 mono" />
      </div>
      {needle &&
        (hits.length ? (
          <ul className="text-sm space-y-1">
            {hits.map((p) => (
              <li key={p.id}>
                <a href={`#${p.id}`} className="text-primary hover:underline mono">{p.id}</a>: {p.min_severity}+ within {String(p.sla_days)} days, {formatGen(p.bond)} GEN bonded
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No active pledge for “{q.trim()}” yet. Depend on it? You can sponsor one with “Make a pledge”.</p>
        ))}
    </div>
  );
}
