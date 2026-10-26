"use client";

import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import {
  CODE_LABEL,
  OUTCOME_TEXT,
  advisoryUrl,
  evidenceOf,
  facts as factsOf,
  formatGen,
  sameAddress,
  timeline as timelineOf,
  windowLeftSeconds,
  type Claim,
  type EvidencePacket,
  type Pledge,
} from "@/lib/contracts/types";
import { usePledgeWrite } from "@/lib/hooks/usePatchPledge";
import { useWallet } from "@/lib/genlayer/wallet";
import { useNow } from "@/lib/hooks/useNow";
import { formatAddress } from "@/lib/genlayer/wallet";
import { VerdictBadge } from "./VerdictBadge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

const day = (iso?: string) => (iso ? iso.slice(0, 10) : "—");

function Countdown({ seconds }: { seconds: number }) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return <span className="mono">{m}:{String(s).padStart(2, "0")}</span>;
}

/** A claim: the ruling, its reason, what validators read, its timeline and what you can do now. */
export function ClaimCard({ claim, pledge }: { claim: Claim; pledge: Pledge }) {
  const { address } = useWallet();
  const { write, pending } = usePledgeWrite();
  const now = useNow(1000);
  const [statement, setStatement] = useState("");
  const f = factsOf(claim);
  const steps = timelineOf(claim);
  const packets = evidenceOf(claim);
  const left = windowLeftSeconds(claim, now);
  const isPledger = sameAddress(pledge.pledger, address);
  const isReporter = sameAddress(claim.claimant, address);
  const open = claim.state === "pending";
  const breach = claim.verdict === "BREACHED";
  const canContest = open && left > 0 && (breach ? isPledger && !claim.pledger_contested : isReporter && !claim.claimant_contested);
  const canSettle = open && (left === 0 || (breach ? isPledger : isReporter));
  const busy = pending === `contest:${claim.id}` || pending === `settle:${claim.id}`;

  return (
    <div className="rounded-lg border border-border bg-[#FBFAF7] p-3 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono text-xs text-muted-foreground">{claim.id}</span>
        <a href={advisoryUrl(claim.advisory)} target="_blank" rel="noopener noreferrer" className="mono font-medium hover:text-primary inline-flex items-center gap-1">
          {claim.advisory}
          <ExternalLink className="w-3 h-3" />
        </a>
        <VerdictBadge verdict={claim.verdict} />
        <span className="text-xs text-muted-foreground">{CODE_LABEL[claim.code] ?? claim.code}</span>
        <span className="ml-auto text-xs">
          {open ? (
            left > 0 ? (
              <span className="text-[#B45309]">
                response window <Countdown seconds={left} />
              </span>
            ) : (
              <span className="text-[#B45309]">ready to settle</span>
            )
          ) : (
            <span className="text-muted-foreground">{OUTCOME_TEXT[claim.outcome] ?? "settled"}</span>
          )}
        </span>
      </div>

      <p className="leading-relaxed">
        <span className="font-semibold">Why: </span>
        {claim.why}
      </p>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">What the validators read</summary>
        <dl className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
          <div><dt className="text-muted-foreground">Sources</dt><dd className="mono">{f.advisory_sources?.join(" + ") || "—"}</dd></div>
          <div><dt className="text-muted-foreground">Severity (OSV / GitHub)</dt><dd className="mono">{f.severity_osv || "—"} / {f.severity_github || "—"} (floor {f.min_severity})</dd></div>
          <div><dt className="text-muted-foreground">Published (later of the two)</dt><dd className="mono">{day(f.published)}</dd></div>
          <div><dt className="text-muted-foreground">Deadline</dt><dd className="mono">{day(f.deadline)} ({f.sla_days} days)</dd></div>
          <div><dt className="text-muted-foreground">Fixed versions</dt><dd className="mono">{f.fixed_versions?.length ? f.fixed_versions.join(", ") + ((f.fixed_count ?? 0) > f.fixed_versions.length ? ` (+${(f.fixed_count ?? 0) - f.fixed_versions.length} more, all checked)` : "") : "none listed"}</dd></div>
          <div><dt className="text-muted-foreground">First fix released</dt><dd className="mono">{f.first_fix ? `${f.first_fix} on ${day(f.first_fix_at)} (deps.dev)` : "—"}</dd></div>
          <div><dt className="text-muted-foreground">Confirmed by</dt><dd className="mono">{f.second_source ? `${f.second_source}: ${day(f.second_fix_at)}` : "—"}</dd></div>
          <div><dt className="text-muted-foreground">Scope check</dt><dd className="mono">{f.scope_answer || "not needed"}</dd></div>
        </dl>
        {claim.statement_url && (
          <p className="mt-2">
            Pledger&apos;s statement:{" "}
            <a href={claim.statement_url} target="_blank" rel="noopener noreferrer" className="mono text-primary break-all hover:underline">{claim.statement_url}</a>
          </p>
        )}
        {packets.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="font-medium text-foreground">Evidence packets (one per assessment, stored on-chain)</p>
            {packets.map((e, i) => (
              <Packet key={i} n={i + 1} e={e} />
            ))}
          </div>
        )}
      </details>

      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
            <span className="mono">{s.at.slice(5, 16).replace("T", " ")}</span>
            <span className="text-foreground">
              {s.event === "filed" && <>filed by {formatAddress(claim.claimant)}{` → ${s.verdict}`}</>}
              {s.event === "contested" && <>{s.by} contested: {s.before} → {s.verdict}</>}
              {s.event === "settled" &&
                (s.outcome === "paid"
                  ? `paid ${formatGen(s.beneficiary)} GEN to the beneficiary, ${formatGen(s.reporter)} GEN + stake to the reporter`
                  : OUTCOME_TEXT[s.outcome ?? ""] ?? "settled")}
            </span>
          </li>
        ))}
      </ol>

      {(canContest || canSettle) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {canContest && breach && (
            <Input
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="Optional https:// link to your statement (why the package is not affected)"
              className="h-8 text-xs flex-1 min-w-[16rem]"
            />
          )}
          {canContest && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => write({ kind: "contest", claimId: claim.id, statementUrl: breach ? statement.trim() : "" })}
              title="Your side gets one fresh assessment. The response window restarts so the other side can answer."
            >
              {pending === `contest:${claim.id}` && <Loader2 className="w-3 h-3 animate-spin" />}
              Contest once
            </Button>
          )}
          {canSettle && (
            <Button size="sm" disabled={busy} onClick={() => write({ kind: "settle", claimId: claim.id })}>
              {pending === `settle:${claim.id}` && <Loader2 className="w-3 h-3 animate-spin" />}
              {left > 0 ? (breach ? "Concede and pay now" : "Accept ruling now") : "Settle"}
            </Button>
          )}
        </div>
      )}
      {open && left > 0 && !canContest && !canSettle && (
        <p className="text-xs text-muted-foreground">
          {breach
            ? "Only the pledger can contest or concede during the window. After it, anyone can settle."
            : "Only the reporter can contest or accept during the window. After it, anyone can settle."}
        </p>
      )}
    </div>
  );
}

/** What each source said in one assessment, with the hashes that commit to it. */
function Packet({ n, e }: { n: number; e: EvidencePacket }) {
  const hash = (h?: string) => <span className="mono">{h ? `${h.slice(0, 14)}…` : "—"}</span>;
  const link = (href?: string, text?: string) =>
    href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary break-all hover:underline">{text ?? href}</a> : "—";
  return (
    <div className="rounded-md border border-border bg-card p-2 space-y-1">
      <p className="text-muted-foreground">#{n} read {e.read_at?.replace("T", " ")} UTC · packet {hash(e.packet_sha256)}</p>
      {e.osv && (
        <p>{link(e.osv.url, "OSV")} (HTTP {e.osv.status}) · {e.osv.severity || "—"} · published {day(e.osv.published)} · fixes {e.osv.fixed?.join(", ") || "none"} · {hash(e.osv.fields_sha256)}</p>
      )}
      {e.github && (
        <p>{link(e.github.url, "GitHub Advisory DB")} (HTTP {e.github.status}) · {e.github.severity || "—"} · published {day(e.github.published)} · fixes {e.github.fixed?.join(", ") || "none"} · {hash(e.github.fields_sha256)}</p>
      )}
      {e.deps_dev && Object.keys(e.deps_dev.dates).length > 0 && (
        <p>{link(e.deps_dev.url, "deps.dev")} release dates: {Object.entries(e.deps_dev.dates).map(([v, t]) => `${v} ${day(t)}`).join(", ")}</p>
      )}
      {e.second_source && <p>Second source: {link(e.second_source.url, e.second_source.version)} released {day(e.second_source.published) || "not readable"}</p>}
      {e.statement && <p>Pledger statement {link(e.statement.url)} · {e.statement.chars} characters · {hash(e.statement.sha256)}</p>}
    </div>
  );
}
