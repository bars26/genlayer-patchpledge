"use client";

import { useState } from "react";
import { FileWarning, Loader2, Search } from "lucide-react";
import { CODE_LABEL, GHSA_RE, formatGen, parseJson, stakeFor, type Claim, type Pledge, type Verdict } from "@/lib/contracts/types";
import { usePledgeWrite } from "@/lib/hooks/usePatchPledge";
import { useWallet } from "@/lib/genlayer/wallet";
import { VerdictBadge } from "./VerdictBadge";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Preview = {
  verdict: Verdict;
  code: string;
  scopeStep?: boolean;
  facts: { severity?: string; published?: string; deadline?: string; fixed_versions?: string[]; first_fix?: string; first_fix_at?: string; summary?: string; days_late?: number };
  listed?: string[];
  error?: string;
};

/** Report a missed deadline: preview the ruling from public data first, then stake and file. */
export function FileClaimModal({ pledge, claims }: { pledge: Pledge; claims: Claim[] }) {
  const { isConnected } = useWallet();
  const { writeAsync, pending } = usePledgeWrite();
  const [open, setOpen] = useState(false);
  const [advisory, setAdvisory] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const id = advisory.trim();
  const valid = GHSA_RE.test(id);
  const stake = stakeFor(pledge);
  // The contract refunds these two cases; say so before anyone stakes.
  const alreadyPaid = parseJson<string[]>(pledge.paid_json, []).includes(id);
  const openClaim = claims.find((c) => c.state === "pending" && c.advisory === id);
  const blocked = alreadyPaid ? "This advisory has already been paid from this pledge; filing it again would be refunded." : openClaim ? `${openClaim.id} is already open for this advisory; you can follow it on this card.` : "";

  const check = async () => {
    setChecking(true);
    setPreview(null);
    try {
      const qs = new URLSearchParams({
        advisory: id,
        ecosystem: pledge.ecosystem,
        package: pledge.package,
        min_severity: pledge.min_severity,
        sla_days: String(pledge.sla_days),
        coverage_start: pledge.coverage_start,
        coverage_end: pledge.coverage_end,
        has_scope: pledge.scope ? "1" : "0",
      });
      const res = await fetch(`/api/precheck?${qs}`);
      setPreview(await res.json());
    } catch {
      setPreview({ verdict: "UNCLEAR", code: "osv_unreachable", facts: {}, error: "The preview could not reach OSV right now. You can still file; validators read the sources themselves." });
    } finally {
      setChecking(false);
    }
  };

  const file = async () => {
    try {
      await writeAsync({ kind: "file", pledgeId: pledge.id, advisory: id });
      setOpen(false);
      setAdvisory("");
      setPreview(null);
    } catch {
      // shown in the toast and the transactions panel
    }
  };

  const notDue = preview?.code === "not_due";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <FileWarning className="w-4 h-4" />
          Report a missed deadline
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report a breach of {pledge.package}</DialogTitle>
          <DialogDescription>
            Paste the GitHub advisory id (GHSA-…). You stake <strong>{formatGen(stake)} GEN</strong> (10% of the payout). If validators find the deadline was
            missed, you get your stake back plus <strong>{formatGen(stake)} GEN</strong>; if the promise was kept or the advisory is not covered, your stake goes to
            the bond. If a source cannot be read, your stake comes back.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="adv">Advisory id</Label>
            <div className="flex gap-2">
              <Input id="adv" value={advisory} onChange={(e) => { setAdvisory(e.target.value); setPreview(null); }} placeholder="GHSA-xxxx-xxxx-xxxx" className="mono" />
              <Button type="button" variant="secondary" onClick={check} disabled={!valid || checking}>
                {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Preview
              </Button>
            </div>
            {!valid && id && <p className="text-xs text-destructive">That is not a GitHub advisory id. Find it on github.com/advisories or osv.dev.</p>}
            {valid && blocked && <p className="text-xs text-[#B45309]">{blocked}</p>}
          </div>

          {preview && (
            <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm space-y-2">
              {preview.error ? (
                <p className="text-destructive">{preview.error}</p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Likely ruling:</span>
                    {notDue ? <span className="font-semibold text-[#B45309]">Not due yet</span> : <VerdictBadge verdict={preview.verdict} />}
                    <span className="text-xs text-muted-foreground">{CODE_LABEL[preview.code] ?? preview.code}</span>
                  </div>
                  {preview.facts.summary && <p className="text-xs">{preview.facts.summary}</p>}
                  <p className="text-xs text-muted-foreground mono">
                    {preview.facts.severity && `${preview.facts.severity} · `}
                    {preview.facts.published && `published ${preview.facts.published.slice(0, 10)} · `}
                    {preview.facts.deadline && `deadline ${preview.facts.deadline.slice(0, 10)} · `}
                    {preview.facts.first_fix ? `first fix ${preview.facts.first_fix} on ${preview.facts.first_fix_at?.slice(0, 10)}` : preview.facts.deadline ? "no fix listed" : ""}
                  </p>
                  {preview.listed && <p className="text-xs">This advisory lists: <span className="mono">{preview.listed.join(", ")}</span></p>}
                  {notDue && <p className="text-xs">The contract refunds a claim filed before the deadline, so wait until {preview.facts.deadline?.slice(0, 10)}.</p>}
                  {preview.scopeStep && <p className="text-xs">The deadline was missed. Because this pledge has a written scope, validators will also judge whether the advisory falls inside it.</p>}
                  {preview.verdict !== "BREACHED" && !notDue && <p className="text-xs text-[#B45309]">If you file anyway and the ruling stays the same, your stake goes to the bond.</p>}
                  <p className="text-[11px] text-muted-foreground">Preview from the same public data validators read. The ruling itself is made on-chain.</p>
                </>
              )}
            </div>
          )}

          <Button className="w-full" onClick={file} disabled={!isConnected || !valid || !!blocked || pending === `file:${pledge.id}` || notDue}>
            {pending === `file:${pledge.id}` && <Loader2 className="w-4 h-4 animate-spin" />}
            {isConnected ? `Stake ${formatGen(stake)} GEN and file` : "Connect a wallet to file"}
          </Button>
          <p className="text-xs text-muted-foreground">Validators read OSV and deps.dev during the transaction; it usually takes 1 to 3 minutes.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
