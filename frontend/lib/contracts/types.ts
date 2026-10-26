/** Types and display helpers for the PatchPledge contract. */

export type Verdict = "BREACHED" | "KEPT" | "NOT_COVERED" | "EXCUSED" | "UNCLEAR";
export type Ecosystem = "npm" | "PyPI";
type Num = string | number | bigint;

export interface Pledge {
  id: string;
  pledger: string;
  ecosystem: Ecosystem;
  package: string;
  min_severity: "MODERATE" | "HIGH" | "CRITICAL";
  sla_days: Num;
  scope: string;
  payout: Num;
  max_payouts: Num;
  beneficiary: string;
  coverage_start: string;
  coverage_end: string;
  state: "active" | "closed";
  bond: Num;
  total_bonded: Num;
  backers_json: string;
  maintainer_json: string;
  total_paid: Num;
  stakes_kept: Num;
  pending: Num;
  paid_json: string;
  claim_ids_json: string;
  n_breached: Num;
  n_kept: Num;
  n_other: Num;
  history_json: string;
}

export interface Claim {
  id: string;
  pledge_id: string;
  advisory: string;
  claimant: string;
  stake: Num;
  filed_at: string;
  window_from: string;
  state: "pending" | "settled";
  verdict: Verdict;
  code: string;
  facts_json: string;
  evidence_json: string;
  why: string;
  statement_url: string;
  pledger_contested: boolean;
  claimant_contested: boolean;
  outcome: "" | "paid" | "stake_returned" | "stake_to_bond";
  timeline_json: string;
}

/** What every validator read from OSV and deps.dev, and agreed on, for a ruling. */
export interface ClaimFacts {
  advisory?: string;
  package?: string;
  severity?: string;
  severity_osv?: string;
  severity_github?: string;
  advisory_sources?: string[];
  second_source?: string;
  second_fix_at?: string;
  min_severity?: string;
  sla_days?: number;
  published?: string;
  deadline?: string;
  fixed_versions?: string[];
  fixed_count?: number;
  first_fix?: string;
  first_fix_at?: string;
  days_late?: number | null;
  timing?: string;
  scope_answer?: string;
}

/** One assessment's evidence packet: what each source said, with sha256 hashes. */
export interface EvidencePacket {
  read_at?: string;
  packet_sha256?: string;
  osv?: { url: string; status: number; published?: string; severity?: string; fixed?: string[]; fields_sha256?: string };
  github?: { url: string; status: number; published?: string; severity?: string; fixed?: string[]; fields_sha256?: string };
  deps_dev?: { url: string; dates: Record<string, string>; unreadable: number };
  second_source?: { url: string; version: string; published: string };
  statement?: { url: string; sha256: string; chars: number; excerpt: string };
}

export interface Maintainer {
  status: "unchecked" | "verified" | "no_repo" | "file_missing" | "address_missing" | "unreachable";
  repo?: string;
  file?: string;
  file_sha256?: string;
  checked_at?: string;
}

export interface TimelineStep {
  at: string;
  event: "filed" | "contested" | "settled";
  by?: string;
  before?: string;
  verdict?: string;
  code?: string;
  outcome?: string;
  amount?: string;
  beneficiary?: string;
  reporter?: string;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const RESPONSE_WINDOW_SECONDS = 600;
export const MIN_PAYOUT_WEI = 10n ** 18n;
export const SEVERITIES = ["MODERATE", "HIGH", "CRITICAL"] as const;
export const GHSA_RE = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/;

export function wei(v: Num | undefined): bigint {
  try {
    return BigInt(String(v ?? "0").split(".")[0]);
  } catch {
    return 0n;
  }
}

export function formatGen(v: Num | undefined, digits = 2): string {
  const n = Number(wei(v)) / 1e18;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function parseGen(input: string): bigint | null {
  const t = input.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
}

export function parseJson<T>(json: string | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export const sameAddress = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Contract timestamps are UTC without a zone suffix in some places; read them as UTC. */
export function utcMs(iso: string): number {
  if (!iso) return NaN;
  const t = iso.trim();
  return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(t) ? t : `${t}Z`);
}

export function windowLeftSeconds(claim: Claim, now = Date.now()): number {
  return Math.max(0, Math.ceil(RESPONSE_WINDOW_SECONDS - (now - utcMs(claim.window_from)) / 1000));
}

export const todayUtc = () => new Date().toISOString().slice(0, 10);
export const facts = (c: Claim) => parseJson<ClaimFacts>(c.facts_json, {});
export const timeline = (c: Claim) => parseJson<TimelineStep[]>(c.timeline_json, []);
export const stakeFor = (p: Pledge) => wei(p.payout) / 10n;
export const evidenceOf = (c: Claim) => parseJson<EvidencePacket[]>(c.evidence_json, []);
export const backersOf = (p: Pledge) => parseJson<Record<string, string>>(p.backers_json, {});
export const maintainerOf = (p: Pledge) => parseJson<Maintainer>(p.maintainer_json, { status: "unchecked" });
export const MAX_PAYOUTS = 10;

/** Payouts left, reserved by open claims, and the liability the bond must cover; same rule as the contract. */
export function coverageOf(p: Pledge) {
  const left = p.state === "active" ? Number(p.max_payouts) - Number(p.n_breached) : 0;
  const reserved = Number(p.pending);
  const liability = wei(p.payout) * BigInt(Math.max(left, 0));
  return { left, reserved, free: Math.max(left - reserved, 0), liability, covered: wei(p.bond) >= liability };
}

export const MAINTAINER_TEXT: Record<Maintainer["status"], string> = {
  unchecked: "maintainer not checked yet",
  verified: "verified maintainer",
  no_repo: "no GitHub repository on the registry",
  file_missing: "sponsor pledge: the repository has no .patchpledge file",
  address_missing: "sponsor pledge: .patchpledge does not list this wallet",
  unreachable: "maintainer check could not reach GitHub",
};

export const packageUrl = (eco: string, name: string) =>
  eco === "PyPI" ? `https://pypi.org/project/${name}/` : `https://www.npmjs.com/package/${name}`;
export const advisoryUrl = (id: string) => `https://github.com/advisories/${id}`;
export const osvUrl = (id: string) => `https://osv.dev/vulnerability/${id}`;

/** The day after which anyone may close the pledge: coverage end plus the full SLA. */
export function withdrawAfter(p: Pledge): string {
  const d = new Date(`${p.coverage_end}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(p.sla_days) + 1);
  return d.toISOString().slice(0, 10);
}

export const VERDICT_STYLE: Record<Verdict, { label: string; cls: string; help: string }> = {
  BREACHED: {
    label: "Breached",
    cls: "bg-[#FDECEA] text-[#B42318] border-[#F4C7C1]",
    help: "The deadline passed without a fix. The bond pays the beneficiary, and the reporter gets 10%.",
  },
  KEPT: {
    label: "Kept",
    cls: "bg-[#E3F4EE] text-[#0E7C66] border-[#B9E2D5]",
    help: "A fixed version was released before the deadline. The reporter's stake goes to the bond.",
  },
  NOT_COVERED: {
    label: "Not covered",
    cls: "bg-[#EFECE4] text-[#4A4F59] border-[#DDD8CC]",
    help: "The advisory is outside the pledge's terms (package, severity or dates), or it was withdrawn.",
  },
  EXCUSED: {
    label: "Excused",
    cls: "bg-[#EAF0FD] text-[#1D4ED8] border-[#C7D6F8]",
    help: "The deadline was missed, but validators judged the advisory outside the pledge's written scope.",
  },
  UNCLEAR: {
    label: "Unclear",
    cls: "bg-[#FEF3E2] text-[#B45309] border-[#F5D9A8]",
    help: "A data source could not be read, two sources disagreed, or the scope could not be judged. The reporter's stake is returned.",
  },
};

export const OUTCOME_TEXT: Record<string, string> = {
  paid: "Paid from the bond",
  stake_returned: "Stake returned to the reporter",
  stake_to_bond: "Stake added to the bond",
};

export const CODE_LABEL: Record<string, string> = {
  fixed_in_time: "fixed in time",
  late_fix: "fixed late",
  no_fix: "no fix",
  not_found: "advisory not found",
  withdrawn: "advisory withdrawn",
  package: "other package",
  severity: "below the severity floor",
  date: "outside coverage dates",
  no_severity: "no severity rating",
  osv_unreachable: "OSV unreachable",
  registry_unreachable: "registry dates unreadable",
  scope: "outside the written scope",
  scope_unclear: "scope unclear",
  not_due: "not due yet",
  severity_disagrees: "sources disagree on severity",
  dates_disagree: "sources disagree on the release date",
  second_source_unreachable: "release date not confirmed",
};
