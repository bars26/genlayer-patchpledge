"use client";

import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { formatGen, packageUrl, parseGen, sameAddress, todayUtc, wei, withdrawAfter, type Claim, type Pledge } from "@/lib/contracts/types";
import { formatAddress, useWallet } from "@/lib/genlayer/wallet";
import { usePledgeWrite } from "@/lib/hooks/usePatchPledge";
import { ClaimCard } from "./ClaimCard";
import { EcoBadge } from "./VerdictBadge";
import { FileClaimModal } from "./FileClaimModal";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const sevText: Record<string, string> = { MODERATE: "MODERATE or worse", HIGH: "HIGH or CRITICAL", CRITICAL: "CRITICAL" };

/** One pledge: the promise in plain words, its bond and record, its claims and the actions open to you. */
export function PledgeCard({ pledge, claims }: { pledge: Pledge; claims: Claim[] }) {
  const { address } = useWallet();
  const { write, pending } = usePledgeWrite();
  const [topUp, setTopUp] = useState("");
  const isPledger = sameAddress(pledge.pledger, address);
  const active = pledge.state === "active";
  const unlock = withdrawAfter(pledge);
  const openClaims = claims.filter((c) => c.state === "pending");
  const settled = claims.filter((c) => c.state !== "pending");
  const topUpWei = parseGen(topUp);

  return (
    <article className="brand-card p-4 md:p-5 space-y-3">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <EcoBadge eco={pledge.ecosystem} />
            <a href={packageUrl(pledge.ecosystem, pledge.package)} target="_blank" rel="noopener noreferrer" className="mono text-lg font-semibold hover:text-primary inline-flex items-center gap-1">
              {pledge.package}
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <span className="mono text-xs text-muted-foreground">{pledge.id}</span>
            {!active && <span className="text-xs rounded-full border border-border px-2 py-0.5 text-muted-foreground">closed</span>}
          </div>
          <p className="mt-1 text-sm">
            Promise: advisories rated <strong>{sevText[pledge.min_severity]}</strong> get a fixed release within{" "}
            <strong>{String(pledge.sla_days)} days</strong> of publication, for advisories published {pledge.coverage_start} to {pledge.coverage_end}.
          </p>
          {pledge.scope && (
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Scope: </span>
              {pledge.scope}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-2xl font-bold">{formatGen(pledge.bond)} <span className="text-sm font-medium text-muted-foreground">GEN bonded</span></p>
          <p className="text-xs text-muted-foreground">pays {formatGen(pledge.payout)} GEN per breach</p>
        </div>
      </header>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span>record: <strong className="text-[#0E7C66]">{String(pledge.n_kept)} kept</strong> · <strong className="text-[#B42318]">{String(pledge.n_breached)} breached</strong> · {String(pledge.n_other)} other</span>
        <span>paid out: <strong className="text-foreground">{formatGen(pledge.total_paid)} GEN</strong></span>
        <span>pledger <span className="mono">{formatAddress(pledge.pledger)}</span>{isPledger && " (you)"}</span>
        <span>beneficiary <span className="mono">{formatAddress(pledge.beneficiary)}</span></span>
        <span>bond locked until {unlock}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {active && wei(pledge.bond) > 0n && <FileClaimModal pledge={pledge} claims={claims} />}
        {isPledger && active && (
          <>
            <Input value={topUp} onChange={(e) => setTopUp(e.target.value)} placeholder="GEN" className="h-8 w-20 text-xs" />
            <Button size="sm" variant="secondary" disabled={!topUpWei || pending === `bond:${pledge.id}`} onClick={() => topUpWei && write({ kind: "bond", pledgeId: pledge.id, value: topUpWei })}>
              {pending === `bond:${pledge.id}` && <Loader2 className="w-3 h-3 animate-spin" />}
              Add to bond
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={todayUtc() < unlock || openClaims.length > 0 || pending === `withdraw:${pledge.id}`}
              title={todayUtc() < unlock ? `Locked until ${unlock}: advisories published up to the coverage end still get their full deadline.` : openClaims.length ? "Settle the open claims first." : "Take the rest of the bond back."}
              onClick={() => write({ kind: "withdraw", pledgeId: pledge.id })}
            >
              Withdraw bond
            </Button>
          </>
        )}
      </div>

      {claims.length > 0 && (
        <div className="space-y-2">
          {[...openClaims, ...settled.slice().reverse()].map((c) => (
            <ClaimCard key={c.id} claim={c} pledge={pledge} />
          ))}
        </div>
      )}
    </article>
  );
}
