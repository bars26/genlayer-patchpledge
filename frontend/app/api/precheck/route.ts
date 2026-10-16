/**
 * Preview of the ruling a claim would get, computed the same way the contract's coded checks
 * work (OSV record + deps.dev release dates), so a reporter sees it before staking GEN.
 *
 * It cannot predict the validators' scope judgment: when a pledge has a written scope and the
 * deadline was missed, the preview says the scope step will run. Not cached per user; the OSV and
 * deps.dev answers are cached for 10 minutes at the CDN.
 */

export const dynamic = "force-dynamic";

const SEVERITY_RANK: Record<string, number> = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };
const DAY = 86_400_000;
const GHSA_RE = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/;

const normName = (eco: string, name: string) => (eco === "PyPI" ? name.replace(/[-_.]+/g, "-").toLowerCase() : name);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19) + "Z";
const enc = (s: string) => encodeURIComponent(s);

async function getJson(url: string): Promise<{ status: number; data: any }> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" }, next: { revalidate: 600 } });
    return { status: res.status, data: res.ok ? await res.json() : null };
  } catch {
    return { status: 0, data: null };
  }
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const eco = q.get("ecosystem") === "PyPI" ? "PyPI" : "npm";
  const pkg = q.get("package") || "";
  const advisory = (q.get("advisory") || "").trim();
  const minSeverity = (q.get("min_severity") || "HIGH").toUpperCase();
  const sla = Number(q.get("sla_days") || "0");
  const start = q.get("coverage_start") || "";
  const end = q.get("coverage_end") || "";
  const hasScope = q.get("has_scope") === "1";
  if (!GHSA_RE.test(advisory)) return Response.json({ error: "Use a GitHub advisory id like GHSA-xxxx-xxxx-xxxx." }, { status: 400 });

  const facts: Record<string, unknown> = { advisory, package: `${eco}:${pkg}`, severity: "", published: "", deadline: "", fixed_versions: [], first_fix: "", first_fix_at: "" };
  const out = (verdict: string, code: string, extra: Record<string, unknown> = {}) =>
    Response.json({ verdict, code, facts, ...extra }, { headers: { "Cache-Control": "public, s-maxage=300" } });

  const osv = await getJson(`https://api.osv.dev/v1/vulns/${advisory}`);
  if (osv.status === 404) return out("NOT_COVERED", "not_found");
  if (osv.status !== 200 || osv.data?.id !== advisory) return out("UNCLEAR", "osv_unreachable");
  facts.summary = String(osv.data.summary || "").slice(0, 200);
  if (osv.data.withdrawn) return out("NOT_COVERED", "withdrawn");
  const fixed = new Set<string>();
  let listed = false;
  for (const a of osv.data.affected || []) {
    if (a.package?.ecosystem !== eco || normName(eco, String(a.package?.name || "")) !== normName(eco, pkg)) continue;
    listed = true;
    for (const r of a.ranges || []) if (r.type === "ECOSYSTEM" || r.type === "SEMVER") for (const e of r.events || []) if (e.fixed) fixed.add(String(e.fixed));
  }
  if (!listed) return out("NOT_COVERED", "package", { listed: [...new Set((osv.data.affected || []).map((a: any) => `${a.package?.ecosystem}:${a.package?.name}`))] });
  facts.severity = String(osv.data.database_specific?.severity || "").toUpperCase();
  if (!(String(facts.severity) in SEVERITY_RANK)) return out("UNCLEAR", "no_severity");
  if (SEVERITY_RANK[String(facts.severity)] < SEVERITY_RANK[minSeverity]) return out("NOT_COVERED", "severity");
  const published = Date.parse(String(osv.data.published || "").slice(0, 19) + "Z");
  if (Number.isNaN(published)) return out("UNCLEAR", "osv_unreachable");
  facts.published = iso(published);
  const day = iso(published).slice(0, 10);
  if (day < start || day > end) return out("NOT_COVERED", "date");
  const deadline = published + sla * DAY;
  facts.deadline = iso(deadline);
  const versions = [...fixed].sort().slice(0, 6);
  facts.fixed_versions = versions;

  const system = eco === "PyPI" ? "pypi" : "npm";
  const dates: Record<string, number> = {};
  let failed = 0;
  for (const v of versions) {
    const r = await getJson(`https://api.deps.dev/v3/systems/${system}/packages/${enc(pkg)}/versions/${enc(v)}`);
    const at = r.status === 200 ? Date.parse(String(r.data?.publishedAt || "").slice(0, 19) + "Z") : NaN;
    if (Number.isNaN(at)) failed++;
    else dates[v] = at;
  }
  const first = Object.keys(dates).sort((a, b) => dates[a] - dates[b] || a.localeCompare(b))[0];
  if (first) {
    facts.first_fix = first;
    facts.first_fix_at = iso(dates[first]);
  }
  if (first && dates[first] <= deadline) return out("KEPT", "fixed_in_time");
  if (failed) return out("UNCLEAR", "registry_unreachable");
  if (!versions.length && Date.now() <= deadline) return out("NOT_COVERED", "not_due");
  const timing = versions.length ? "late_fix" : "no_fix";
  if (versions.length) facts.days_late = Math.floor((dates[first] - deadline) / DAY) + 1;
  facts.timing = timing;
  return out("BREACHED", timing, { scopeStep: hasScope });
}
