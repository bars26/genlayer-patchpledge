// Renders docs/REPRODUCTION.md from docs/demo-run.json (written by scripts/demo.mjs) plus the
// claims and pledges as the contract reports them now.
//
//   node scripts/reproduction.mjs

import { readFileSync, writeFileSync } from "fs";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const run = JSON.parse(readFileSync(new URL("../docs/demo-run.json", import.meta.url), "utf8"));
const client = createClient({ chain: studionet, endpoint: "https://studio.genlayer.com/api" });
const read = (functionName, args) => client.readContract({ address: run.contract, functionName, args });
const field = (o, k) => (o instanceof Map ? o.get(k) : o[k]);
const fmt = (wei) => (Number(BigInt(String(wei))) / 1e18).toFixed(2);
run.rulings = [];
for (const id of run.claims.filter(Boolean)) {
  const c = await read("get_claim", [id]);
  const steps = JSON.parse(field(c, "timeline_json")).map((s) => s.event + (s.verdict ? `:${s.verdict}` : "") + (s.outcome ? `:${s.outcome}` : "")).join(" → ");
  run.rulings.push({ id, advisory: field(c, "advisory"), verdict: field(c, "verdict"), code: field(c, "code"), why: field(c, "why"), steps });
}
run.summary = [];
for (const id of run.pledges) {
  const p = await read("get_pledge", [id]);
  run.summary.push(
    `${id} ${field(p, "ecosystem")}:${String(field(p, "package")).padEnd(17)} bond ${fmt(field(p, "bond")).padStart(5)} GEN  paid ${fmt(field(p, "total_paid"))} GEN  kept ${field(p, "n_kept")}  breached ${field(p, "n_breached")}  other ${field(p, "n_other")}  open ${field(p, "pending")}`
  );
}
const balances = [];
for (const [k, a] of Object.entries(run.accounts)) {
  const res = await fetch("https://studio.genlayer.com/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [a, "latest"] }),
  }).then((r) => r.json());
  balances.push(`${k.padEnd(10)} ${fmt(BigInt(res.result))} GEN`);
}
const tx = (h) => `[\`${h.slice(0, 10)}…\`](https://explorer-studio.genlayer.com/tx/${h})`;
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

const rows = run.log.map((r) => {
  const result = r.refused ? `refused: ${r.refused}` : r.returned ?? "";
  return `| ${r.who} | \`${esc(r.call)}\` | ${r.value === "0" ? "" : r.value} | ${r.status} | ${r.exec} | ${esc(result).slice(0, 260)} | ${tx(r.hash)} |`;
});

let uiTest = "";
try {
  const ui = JSON.parse(readFileSync(new URL("../docs/ui-test.json", import.meta.url), "utf8"));
  uiTest = `## Wallet test from the live app

${ui.note} Wallet \`${ui.wallet}\`. All three transactions are FINALIZED with execution result SUCCESS.

| Step | GEN sent | Result | Tx |
|---|---|---|---|
${ui.steps.map(([step, value, result, hash]) => `| ${esc(step)} | ${value} | ${esc(result)} | ${tx(hash)} |`).join("\n")}

On-chain reason for claim_6: ${ui.why}
`;
} catch {
  // no UI test recorded
}

const totals = JSON.parse(await read("totals", []));
const contractBalance = BigInt(
  (await fetch("https://studio.genlayer.com/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [run.contract, "latest"] }),
  }).then((r) => r.json())).result
);
const gen = (w) => (Number(BigInt(String(w))) / 1e18).toFixed(2);
const recon = [
  ...(run.reconciliations ?? []),
  { label: "now (when this file was generated)", bonds: totals.bonds, pending_stakes: totals.pending_stakes, expected: totals.expected_balance, balance: contractBalance.toString(), ok: BigInt(totals.expected_balance) === contractBalance },
].map((r) => `| ${r.label} | ${gen(r.bonds)} | ${gen(r.pending_stakes)} | ${gen(r.expected)} | ${gen(r.balance)} | ${r.ok ? "match" : "MISMATCH"} |`);
const coverage = Object.entries(run.coverages ?? {}).map(
  ([k, c]) => `| ${k} | ${c.paid} of ${c.max_payouts} | ${c.reserved_by_open_claims} | ${c.payouts_left} | ${gen(c.liability)} | ${gen(c.bond)} | ${c.covered ? "yes" : "no"} | ${c.backers} | ${c.maintainer} |`
);
const packets = Object.entries(run.evidence ?? {}).flatMap(([id, list]) =>
  list.map((e, i) => `| ${id} #${i + 1} | ${e.read_at ?? ""} | OSV ${e.osv ?? "-"} / GitHub ${e.github ?? "-"} | \`${(e.osv_sha256 || "-").slice(0, 12)}…\` / \`${(e.github_sha256 || "-").slice(0, 12)}…\` | ${e.deps_dev ? Object.entries(e.deps_dev).map(([v, t]) => `${v} ${String(t).slice(0, 10)}`).join(", ") : "-"} | ${e.second ? `${e.second.version} ${String(e.second.published).slice(0, 10)}` : "-"} | \`${(e.packet_sha256 || "").slice(0, 12)}…\` |`)
);
const m = run.maintainer ?? {};
const rulings = run.rulings.map((c) => `| ${c.id} | ${c.advisory} | **${c.verdict}** (${c.code}) | ${esc(c.why)} | ${c.steps} |`);

const doc = `# Reproduction log

Live run of \`scripts/demo.mjs\` on GenLayer Studio, against **real** GitHub security advisories, with real validator
consensus, real OSV / deps.dev reads and real LLM calls. Generated by \`scripts/reproduction.mjs\` from
[\`demo-run.json\`](demo-run.json).

- Contract: [\`${run.contract}\`](https://explorer-studio.genlayer.com/address/${run.contract})
  (\`node scripts/verify-code.mjs ${run.contract}\` prints \`identical\`: the deployed code is \`contracts/patch_pledge.py\`).
- The first contract's run is kept in [REPRODUCTION-v1.md](REPRODUCTION-v1.md).
- Throwaway accounts: ${Object.entries(run.accounts).map(([k, a]) => `${k} \`${a}\``).join(", ")}.
- The pledges are **demo pledges made by a test wallet**, not by the packages' maintainers. The advisories, release
  dates and rulings are real.

## Rulings and their reasons

The \`why\` column is the contract's own explanation (\`explain_claim\`), built only from facts all validators agreed on.

| Claim | Advisory | Ruling | Why (on-chain) | Timeline |
|---|---|---|---|---|
${rulings.join("\n")}

## Payout coverage

A pledge pays at most \`max_payouts\` breaches and its bond must cover all of them, so every breach is paid in full.
An open claim reserves one payout until it is settled. \`coverage(pledge_id)\` as read during the run:

| Pledge | Paid | Reserved | Left | Liability (GEN) | Bond (GEN) | Covered | Backers | Maintainer |
|---|---|---|---|---|---|---|---|---|
${coverage.join("\n")}

## Balance reconciliation

\`totals()\` (active bonds plus the stakes of open claims) against the contract's actual balance (\`eth_getBalance\`),
read once every transaction touching the contract had finalized (payouts and refunds are their own transfers):

| When | Active bonds | Open stakes | Expected | Contract balance | Result |
|---|---|---|---|---|---|
${recon.join("\n")}

## Evidence packets

Every assessment stores a packet on the claim (\`evidence_json\`): what OSV and the GitHub Advisory Database said
(status, publication date, severity, fixed versions, and a sha256 of those fields), the deps.dev release dates, the
second source's date for the deciding release, the pledger's statement (URL, sha256, excerpt) and a hash of the whole
packet, which the claim's timeline also records.

| Claim / assessment | Read at (UTC) | Sources (HTTP) | OSV / GitHub fields sha256 | deps.dev | Second source | Packet |
|---|---|---|---|---|---|---|
${packets.join("\n")}

## Maintainer check

\`verify_maintainer\` on the Next.js pledge: validators found the repository \`${m.repo ?? "?"}\` through the npm registry and
looked for \`${m.file ?? "?"}\`. Result: **${m.status ?? "?"}** (a sponsor pledge). A maintainer marks a pledge as
verified by committing a \`.patchpledge\` file that lists the pledging wallet (\`test_verified_maintainer\` covers every outcome).

## Final state

\`\`\`
${run.summary.join("\n")}
\`\`\`

Wallet balances after finalization (funded with pledger 100, reporter 20, fund 1, bystander 1 GEN): the pledger bonded
30 GEN in total, the fund received 2.7 GEN from each of the two breaches, and the reporter lost four 0.2 GEN stakes on
rulings that paid nothing and earned two 0.3 GEN reporter rewards (net -0.2 GEN).

\`\`\`
${balances.join("\n")}
\`\`\`

${uiTest}
## Every transaction

A refused call is still ACCEPTED by consensus; the contract outcome is the \`exec\` column (\`ERROR\` = the contract raised,
on purpose here). Payable calls never raise: they return \`REFUNDED: <reason>\` and send the GEN back, because GenLayer
keeps the value of a reverted call.

| Who | Call | GEN sent | Consensus | Exec | Returned / refused | Tx |
|---|---|---|---|---|---|---|
${rows.join("\n")}

## Run it yourself

\`\`\`bash
npm install
node scripts/deploy.mjs                      # prints the new contract address
node scripts/verify-code.mjs <address>       # deployed code == contracts/patch_pledge.py
node scripts/demo.mjs <address>              # about 20 minutes: includes one 10-minute response window
node scripts/reproduction.mjs                # regenerates this file
\`\`\`
`;

writeFileSync(new URL("../docs/REPRODUCTION.md", import.meta.url), doc);
console.log(`wrote docs/REPRODUCTION.md (${run.log.length} transactions)`);
