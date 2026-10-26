"use client";

import { useState } from "react";
import { BadgeCheck, ExternalLink, Loader2, ShieldQuestion } from "lucide-react";
import {
  MAINTAINER_TEXT,
  backersOf,
  coverageOf,
  formatGen,
  maintainerOf,
  packageUrl,
  parseGen,
  sameAddress,
  todayUtc,
  withdrawAfter,
  type Claim,
  type Pledge,
} from "@/lib/contracts/types";
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
  const cov = coverageOf(pledge);
  const backers = backersOf(pledge);
  const maintainer = maintainerOf(pledge);
  const verified = maintainer.status === "verified";

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
            <span
              className={`inline-flex items-center gap-1 text-xs rounded-full border px-2 py-0.5 ${verified ? "border-[#B9E2D5] bg-[#E3F4EE] text-[#0E7C66]" : "border-border text-muted-foreground"}`}
              title={maintainer.repo ? `${maintainer.repo}${maintainer.checked_at ? `, checked ${maintainer.checked_at.replace("T", " ")} UTC` : ""}` : "Validators look for the pledger's wallet in the repository's .patchpledge file"}
            >
              {verified ? <BadgeCheck className="w-3.5 h-3.5" /> : <ShieldQuestion className="w-3.5 h-3.5" />}
              {MAINTAINER_TEXT[maintainer.status] ?? maintainer.status}
            </span>
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
          <p className="text-xs text-muted-foreground">pays {formatGen(pledge.payout)} GEN per breach, {String(pledge.max_payouts)} at most</p>
        </div>
      </header>

      {active && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          <div className="rounded-md border border-border px-3 py-2">
            <p className="text-muted-foreground">Payouts left</p>
            <p className="font-medium">{cov.left} of {String(pledge.max_payouts)}{cov.reserved ? `, ${cov.reserved} reserved by open claims` : ""}</p>
            <p className={cov.covered ? "text-[#0E7C66]" : "text-[#B42318]"}>
              liability {formatGen(cov.liability)} GEN, bond {formatGen(pledge.bond)} GEN: {cov.covered ? "every breach is paid in full" : "under-covered"}
            </p>
          </div>
          <div className="rounded-md border border-border px-3 py-2">
            <p className="text-muted-foreground">Backers ({Object.keys(backers).length})</p>
            {Object.entries(backers).slice(0, 3).map(([who, amount]) => (
              <p key={who} className="mono">{formatAddress(who)} {formatGen(amount)} GEN{sameAddress(who, pledge.pledger) ? " (pledger)" : ""}</p>
            ))}
            <p className="text-muted-foreground">left-over bond returns pro rata at closing</p>
          </div>
          <div className="rounded-md border border-border px-3 py-2">
            <p className="text-muted-foreground">Bond locked until</p>
            <p className="font-medium">{unlock}</p>
            <p className="text-muted-foreground">coverage end plus the full deadline, and every claim settled</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span>record: <strong className="text-[#0E7C66]">{String(pledge.n_kept)} kept</strong> · <strong className="text-[#B42318]">{String(pledge.n_breached)} breached</strong> · {String(pledge.n_other)} other</span>
        <span>paid out: <strong className="text-foreground">{formatGen(pledge.total_paid)} GEN</strong></span>
        <span>pledger <span className="mono">{formatAddress(pledge.pledger)}</span>{isPledger && " (you)"}</span>
        <span>beneficiary <span className="mono">{formatAddress(pledge.beneficiary)}</span></span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {active && cov.left > 0 && <FileClaimModal pledge={pledge} claims={claims} />}
        {active && todayUtc() <= pledge.coverage_end && (
          <>
            <Input value={topUp} onChange={(e) => setTopUp(e.target.value)} placeholder="GEN" className="h-8 w-20 text-xs" />
            <Button
              size="sm"
              variant="secondary"
              disabled={!topUpWei || pending === `bond:${pledge.id}`}
              title={isPledger ? "Add to your bond" : "Depend on this package? Add GEN to the bond; your share of what is left comes back when the pledge closes."}
              onClick={() => topUpWei && write({ kind: "bond", pledgeId: pledge.id, value: topUpWei })}
            >
              {pending === `bond:${pledge.id}` && <Loader2 className="w-3 h-3 animate-spin" />}
              Back this pledge
            </Button>
          </>
        )}
        {active && (
          <Button size="sm" variant="ghost" disabled={pending === `verify:${pledge.id}`} onClick={() => write({ kind: "verify", pledgeId: pledge.id })}>
            {pending === `verify:${pledge.id}` && <Loader2 className="w-3 h-3 animate-spin" />}
            Check the maintainer
          </Button>
        )}
        {active && (
          <Button
            size="sm"
            variant="ghost"
            disabled={todayUtc() < unlock || openClaims.length > 0 || pending === `withdraw:${pledge.id}`}
            title={todayUtc() < unlock ? `Locked until ${unlock}: advisories published up to the coverage end still get their full deadline.` : openClaims.length ? "Settle the open claims first." : "Return what is left of the bond to the backers, pro rata."}
            onClick={() => write({ kind: "withdraw", pledgeId: pledge.id })}
          >
            Close the pledge
          </Button>
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
