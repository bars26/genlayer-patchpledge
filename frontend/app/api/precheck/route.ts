/**
 * Preview of the ruling a claim would get, computed the same way the contract's coded checks
 * work (OSV and GitHub advisories, deps.dev release dates confirmed by a second source), so a
 * reporter sees it before staking GEN.
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

  // Two advisory databases, as in the contract: "not found" only when both say so, any other failure decides nothing.
  const [osv, gh] = await Promise.all([getJson(`https://api.osv.dev/v1/vulns/${advisory}`), getJson(`https://api.github.com/advisories/${advisory}`)]);
  const okO = osv.status === 200 && osv.data?.id === advisory;
  const okG = gh.status === 200 && gh.data?.ghsa_id === advisory;
  if (osv.status === 404 && gh.status === 404) return out("NOT_COVERED", "not_found");
  if (!(okO || osv.status === 404) || !(okG || gh.status === 404)) return out("UNCLEAR", "osv_unreachable");
  facts.advisory_sources = [okO && "OSV", okG && "GitHub"].filter(Boolean);
  facts.summary = String((okO ? osv.data.summary : gh.data?.summary) || "").slice(0, 200);
  if ((okO && osv.data.withdrawn) || (okG && gh.data.withdrawn_at)) return out("NOT_COVERED", "withdrawn");
  const fixed = new Set<string>();
  const published: number[] = [];
  let listed = false;
  if (okO) {
    for (const a of osv.data.affected || []) {
      if (a.package?.ecosystem !== eco || normName(eco, String(a.package?.name || "")) !== normName(eco, pkg)) continue;
      listed = true;
      for (const r of a.ranges || []) if (r.type === "ECOSYSTEM" || r.type === "SEMVER") for (const e of r.events || []) if (e.fixed) fixed.add(String(e.fixed));
    }
    facts.severity_osv = String(osv.data.database_specific?.severity || "").toUpperCase();
    const t = Date.parse(String(osv.data.published || "").slice(0, 19) + "Z");
    if (!Number.isNaN(t)) published.push(t);
  }
  if (okG) {
    for (const v of gh.data.vulnerabilities || []) {
      const e = { npm: "npm", pip: "PyPI" }[String(v?.package?.ecosystem || "")];
      if (e !== eco || normName(eco, String(v?.package?.name || "")) !== normName(eco, pkg)) continue;
      listed = true;
      if (v.first_patched_version) fixed.add(String(v.first_patched_version));
    }
    facts.severity_github = String(gh.data.severity || "").toUpperCase();
    const t = Date.parse(String(gh.data.published_at || "").slice(0, 19) + "Z");
    if (!Number.isNaN(t)) published.push(t);
  }
  if (!listed) return out("NOT_COVERED", "package", { listed: okO ? [...new Set((osv.data.affected || []).map((a: any) => `${a.package?.ecosystem}:${a.package?.name}`))] : [] });
  const ratings = [...new Set([facts.severity_osv, facts.severity_github].filter((r) => String(r) in SEVERITY_RANK))] as string[];
  if (ratings.length > 1) return out("UNCLEAR", "severity_disagrees");
  if (!ratings.length) return out("UNCLEAR", "no_severity");
  facts.severity = ratings[0];
  if (SEVERITY_RANK[ratings[0]] < SEVERITY_RANK[minSeverity]) return out("NOT_COVERED", "severity");
  if (!published.length) return out("UNCLEAR", "osv_unreachable");
  const pub = Math.max(...published); // the later date: the more lenient deadline
  facts.published = iso(pub);
  const day = iso(pub).slice(0, 10);
  if (day < start || day > end) return out("NOT_COVERED", "date");
  const deadline = pub + sla * DAY;
  facts.deadline = iso(deadline);
  // Every reported fix counts: one deps.dev request lists all versions of the package with dates.
  const versions = [...fixed].sort();
  facts.fixed_versions = versions.slice(0, 12);
  facts.fixed_count = versions.length;

  const system = eco === "PyPI" ? "pypi" : "npm";
  const dates: Record<string, number> = {};
  let failed = 0;
  const listing = await getJson(`https://api.deps.dev/v3/systems/${system}/packages/${enc(pkg)}`);
  if (listing.status === 200 && Array.isArray(listing.data?.versions)) {
    const listed: Record<string, number> = {};
    for (const v of listing.data.versions) {
      const at = Date.parse(String(v?.publishedAt || "").slice(0, 19) + "Z");
      if (typeof v?.versionKey?.version === "string" && !Number.isNaN(at)) listed[v.versionKey.version] = at;
    }
    for (const v of versions) {
      if (v in listed) dates[v] = listed[v];
      else failed++;
    }
  } else if (versions.length > 25) {
    failed = versions.length;
  } else {
    for (const v of versions) {
      const r = await getJson(`https://api.deps.dev/v3/systems/${system}/packages/${enc(pkg)}/versions/${enc(v)}`);
      const at = r.status === 200 ? Date.parse(String(r.data?.publishedAt || "").slice(0, 19) + "Z") : NaN;
      if (Number.isNaN(at)) failed++;
      else dates[v] = at;
    }
  }
  const first = Object.keys(dates).sort((a, b) => dates[a] - dates[b] || a.localeCompare(b))[0];
  if (first) {
    facts.first_fix = first;
    facts.first_fix_at = iso(dates[first]);
  }
  if (first) {
    // The deciding release date must be confirmed by a second source: PyPI itself, or ecosyste.ms for npm.
    const url =
      system === "pypi"
        ? `https://pypi.org/pypi/${enc(pkg)}/${enc(first)}/json`
        : `https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/${enc(pkg)}/versions/${enc(first)}`;
    const r = await getJson(url);
    const times =
      system === "pypi"
        ? (r.data?.urls || []).map((u: any) => Date.parse(String(u?.upload_time_iso_8601 || "").slice(0, 19) + "Z")).filter((t: number) => !Number.isNaN(t))
        : [Date.parse(String(r.data?.published_at || "").slice(0, 19) + "Z")].filter((t: number) => !Number.isNaN(t));
    facts.second_source = system === "pypi" ? "PyPI" : "ecosyste.ms";
    if (r.status !== 200 || !times.length) return out("UNCLEAR", "second_source_unreachable");
    facts.second_fix_at = iso(Math.min(...times));
    if (Math.abs(Math.min(...times) - dates[first]) > DAY) return out("UNCLEAR", "dates_disagree");
  }
  if (first && dates[first] <= deadline) return out("KEPT", "fixed_in_time");
  if (failed) return out("UNCLEAR", "registry_unreachable");
  if (!versions.length && Date.now() <= deadline) return out("NOT_COVERED", "not_due");
  const timing = versions.length ? "late_fix" : "no_fix";
  if (versions.length) facts.days_late = Math.floor((dates[first] - deadline) / DAY) + 1;
  facts.timing = timing;
  return out("BREACHED", timing, { scopeStep: hasScope });
}
