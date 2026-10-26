"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { MAX_PAYOUTS, MIN_PAYOUT_WEI, SEVERITIES, formatGen, parseGen, todayUtc } from "@/lib/contracts/types";
import { usePledgeWrite } from "@/lib/hooks/usePatchPledge";
import { useWallet } from "@/lib/genlayer/wallet";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const yearFromNow = () => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
};

const NPM_RE = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const PYPI_RE = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/** Make a pledge. Every field is checked here with the same rules the contract applies. */
export function CreatePledgeModal() {
  const { address, isConnected } = useWallet();
  const { writeAsync, pending } = usePledgeWrite();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    ecosystem: "npm",
    package: "",
    minSeverity: "HIGH",
    slaDays: "30",
    scope: "",
    payout: "2",
    maxPayouts: "2",
    bond: "",
    beneficiary: "",
    coverageStart: todayUtc(),
    coverageEnd: yearFromNow(),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const payout = parseGen(f.payout);
  const maxPayouts = Number(f.maxPayouts);
  const minBond = payout && Number.isInteger(maxPayouts) && maxPayouts > 0 ? payout * BigInt(maxPayouts) : null;
  const bond = f.bond ? parseGen(f.bond) : minBond;
  const pkg = f.ecosystem === "npm" ? f.package.trim().toLowerCase() : f.package.trim();
  const sla = Number(f.slaDays);
  const problems = [
    !(f.ecosystem === "npm" ? NPM_RE : PYPI_RE).test(pkg) && `Enter a valid ${f.ecosystem} package name.`,
    !(Number.isInteger(sla) && sla >= 1 && sla <= 365) && "The deadline must be 1 to 365 days.",
    !(payout && payout >= MIN_PAYOUT_WEI) && "The payout must be at least 1 GEN.",
    !(Number.isInteger(maxPayouts) && maxPayouts >= 1 && maxPayouts <= MAX_PAYOUTS) && `The pledge pays 1 to ${MAX_PAYOUTS} breaches at most.`,
    !(bond && minBond && bond >= minBond) && "The bond must cover every payout: at least payout × maximum breaches.",
    !/^0x[0-9a-fA-F]{40}$/.test(f.beneficiary.trim()) && "Enter the beneficiary's wallet address.",
    f.coverageStart > f.coverageEnd && "Coverage must start before it ends.",
    f.coverageEnd < todayUtc() && "Coverage cannot end in the past.",
  ].filter(Boolean) as string[];

  const submit = async () => {
    if (problems.length || !payout || !bond) return;
    try {
      await writeAsync({
        kind: "create",
        bond,
        input: {
          ecosystem: f.ecosystem,
          package: pkg,
          minSeverity: f.minSeverity,
          slaDays: sla,
          scope: f.scope.trim(),
          payout,
          maxPayouts,
          beneficiary: f.beneficiary.trim(),
          coverageStart: f.coverageStart,
          coverageEnd: f.coverageEnd,
        },
      });
      setOpen(false);
    } catch {
      // shown in the toast and the transactions panel
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Make a pledge</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Make a patch pledge</DialogTitle>
          <DialogDescription>
            Bond GEN behind a fix deadline for one package. You can be its maintainer or a sponsor who depends on it. The bond covers every payout in
            full and stays locked until the coverage period and the last deadline have passed. Others can back your pledge with more GEN.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="space-y-1">
            <Label>Ecosystem</Label>
            <select value={f.ecosystem} onChange={set("ecosystem")} className="h-9 w-full rounded-md border border-border bg-card px-2">
              <option value="npm">npm</option>
              <option value="PyPI">PyPI</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>Package</Label>
            <Input value={f.package} onChange={set("package")} placeholder={f.ecosystem === "npm" ? "left-pad or @scope/name" : "requests"} className="mono" />
          </div>
          <div className="space-y-1">
            <Label>Covers advisories rated</Label>
            <select value={f.minSeverity} onChange={set("minSeverity")} className="h-9 w-full rounded-md border border-border bg-card px-2">
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{s} and above</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Fix within (days)</Label>
            <Input value={f.slaDays} onChange={set("slaDays")} inputMode="numeric" />
          </div>
          <div className="space-y-1">
            <Label>Payout per breach (GEN)</Label>
            <Input value={f.payout} onChange={set("payout")} inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <Label>Pays at most (breaches)</Label>
            <Input value={f.maxPayouts} onChange={set("maxPayouts")} inputMode="numeric" />
          </div>
          <div className="space-y-1 col-span-2">
            <Label>Bond (GEN)</Label>
            <Input value={f.bond} onChange={set("bond")} inputMode="decimal" placeholder={minBond ? formatGen(minBond) : ""} />
            <p className="text-xs text-muted-foreground">At least payout × maximum breaches, so every breach is paid in full.</p>
          </div>
          <div className="space-y-1 col-span-2">
            <Label>Beneficiary wallet</Label>
            <div className="flex gap-2">
              <Input value={f.beneficiary} onChange={set("beneficiary")} placeholder="0x… (e.g. a users' security fund)" className="mono" />
              {address && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setF({ ...f, beneficiary: address })}>
                  Use mine
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label>Advisories published from</Label>
            <Input type="date" value={f.coverageStart} onChange={set("coverageStart")} />
          </div>
          <div className="space-y-1">
            <Label>until</Label>
            <Input type="date" value={f.coverageEnd} onChange={set("coverageEnd")} />
          </div>
          <div className="space-y-1 col-span-2">
            <Label>Scope (optional)</Label>
            <textarea
              value={f.scope}
              onChange={set("scope")}
              maxLength={600}
              rows={2}
              placeholder="e.g. Covers code execution, file writes and data exposure. Denial-of-service issues are excluded."
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground">Only used when a deadline was missed: validators then judge whether the advisory falls inside this text.</p>
          </div>
        </div>
        {problems.length > 0 && f.package && (
          <ul className="text-xs text-destructive list-disc pl-4">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        <Button onClick={submit} disabled={!isConnected || problems.length > 0 || pending === "create"} className="w-full">
          {pending === "create" && <Loader2 className="w-4 h-4 animate-spin" />}
          {isConnected ? `Bond ${bond ? formatGen(bond) : "?"} GEN and pledge` : "Connect a wallet to pledge"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
