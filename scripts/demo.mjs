// Live end-to-end demo of PatchPledge on GenLayer Studio, using real GitHub advisories.
//
//   node scripts/demo.mjs <contract-address>
//
// Creates throwaway Studio accounts (a pledger, a reporter, a beneficiary fund and a bystander),
// funds them from the Studio faucet, then runs real advisories through five pledges. The pledges
// are DEMO pledges made by test wallets, not by the packages' maintainers. Every call prints its
// transaction hash, consensus status and the contract's own execution result.

import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { writeFileSync } from "fs";

const [CONTRACT] = process.argv.slice(2);
if (!CONTRACT) {
  console.error("usage: node scripts/demo.mjs <contract-address>");
  process.exit(1);
}
const RPC = "https://studio.genlayer.com/api";
const GEN = 10n ** 18n;
const WINDOW_MS = 600_000;

function client(account) {
  return createClient({ chain: studionet, endpoint: RPC, account });
}

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const TRANSIENT = /rate limit|Unexpected token '<'|not valid JSON|fetch failed|ECONNRESET|socket hang up|50[234]/i;

async function write(c, who, functionName, args, value = 0n, { expectError = false } = {}) {
  const from = c.account.address;
  for (let attempt = 1; ; attempt++) {
    const nonceBefore = BigInt(await rpc("eth_getTransactionCount", [from, "latest"]));
    try {
      let hash;
      try {
        hash = await c.writeContract({ address: CONTRACT, functionName, args, value });
      } catch (err) {
        // The RPC sometimes answers a send with an HTML error page. Only resend if the
        // nonce did not move; otherwise the first send went through and we pick it up.
        if (!TRANSIENT.test(String(err?.message || err))) throw err;
        await sleep(15000);
        const nonceAfter = BigInt(await rpc("eth_getTransactionCount", [from, "latest"]));
        if (nonceAfter === nonceBefore) throw err;
        const txs = await rpc("sim_getTransactionsForAddress", [from]);
        hash = txs.filter((t) => (t.from_address || "").toLowerCase() === from.toLowerCase()).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0].hash;
        console.log(`  send answered with an error page but the tx exists: ${hash}`);
      }
      // Once a hash exists, only the wait is retried; the transaction is never sent twice.
      let receipt;
      for (let wait = 1; ; wait++) {
        try {
          receipt = await c.waitForTransactionReceipt({ hash, status: "ACCEPTED", retries: 60, interval: 5000 });
          break;
        } catch (err) {
          if (!TRANSIENT.test(String(err?.message || err)) || wait >= 6) throw Object.assign(err, { sent: true });
          await sleep(10000 * wait);
        }
      }
      const lr = receipt?.consensus_data?.leader_receipt;
      const first = Array.isArray(lr) ? lr[0] : lr;
      const exec = first?.execution_result ?? "?";
      let returned = first?.result?.payload?.readable;
      try { returned = JSON.parse(returned); } catch {}
      const row = {
        who,
        call: `${functionName}(${args.map((a) => (typeof a === "bigint" ? `${Number(a) / 1e18} GEN` : JSON.stringify(a)).slice(0, 40)).join(", ")})`,
        value: (Number(value) / 1e18).toString(),
        hash,
        status: receipt.statusName ?? receipt.status_name ?? "ACCEPTED",
        exec,
        returned: typeof returned === "string" ? returned : undefined,
      };
      log.push(row);
      console.log(`${row.who.padEnd(11)} ${row.call.padEnd(58)} ${row.status.padEnd(9)} ${row.exec.padEnd(7)} ${hash}${row.returned ? "  -> " + row.returned.slice(0, 160) : ""}`);
      if (expectError) {
        if (exec !== "ERROR") throw new Error(`${functionName} was expected to be refused but executed with ${exec}`);
        const msg = typeof first?.result?.payload === "string" ? first.result.payload : "";
        row.refused = msg;
        console.log(`  -> refused as designed: ${msg}`);
        return row;
      }
      if (exec !== "SUCCESS") throw new Error(`${functionName} executed with ${exec}`);
      return row;
    } catch (err) {
      const msg = String(err?.message || err);
      if (TRANSIENT.test(msg) && attempt < 5 && !err?.sent) {
        console.log(`  transient RPC error (${msg.slice(0, 60)}), waiting ${15 * attempt}s`);
        await sleep(15000 * attempt);
        continue;
      }
      throw err;
    }
  }
}

async function read(c, functionName, args = []) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await c.readContract({ address: CONTRACT, functionName, args });
    } catch (err) {
      if (TRANSIENT.test(String(err?.message)) && attempt < 6) {
        await sleep(15000 * attempt);
        continue;
      }
      throw err;
    }
  }
}

const balance = async (addr) => BigInt(await rpc("eth_getBalance", [addr, "latest"]));
const fmt = (wei) => (Number(wei) / 1e18).toFixed(2);
const fund = async (addr, gen) => rpc("sim_fundAccount", [addr, Number(gen * GEN)]);
const field = (obj, name) => (obj instanceof Map ? obj.get(name) : obj[name]);

const keys = { pledger: generatePrivateKey(), reporter: generatePrivateKey(), fund: generatePrivateKey(), bystander: generatePrivateKey(), backer: generatePrivateKey() };
const acct = Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, createAccount(v)]));
const P = client(acct.pledger);
const R = client(acct.reporter);
const F = client(acct.fund);
const B = client(acct.bystander);
const K = client(acct.backer);
if (process.env.DEMO_KEYS) writeFileSync(process.env.DEMO_KEYS, JSON.stringify(keys));

console.log("contract  ", CONTRACT);
for (const [k, a] of Object.entries(acct)) console.log(k.padEnd(10), a.address);
await fund(acct.pledger.address, 100n);
await fund(acct.reporter.address, 20n);
await fund(acct.fund.address, 1n);
await fund(acct.bystander.address, 1n);
await fund(acct.backer.address, 10n);
await sleep(3000);
const start = Object.fromEntries(await Promise.all(Object.entries(acct).map(async ([k, a]) => [k, await balance(a.address)])));
console.log(`funded: ${Object.entries(start).map(([k, v]) => `${k} ${fmt(v)}`).join(", ")} GEN\n`);

const firstPledge = (await read(P, "get_pledges", [0, 200])).length;
let nextClaim = (await read(P, "get_claims", [0, 200])).length;
const pid = (n) => `pledge_${firstPledge + n}`;
const NO_DOS = "Covers arbitrary code execution, file writes outside the target directory, data exposure and authentication bypass. Denial-of-service issues are excluded.";

const ruling = async (claimId, label) => {
  const c = await read(P, "get_claim", [claimId]);
  console.log(`  -> ${label}: ${field(c, "verdict")} (${field(c, "code")}) ${field(c, "why")}`);
  return field(c, "verdict");
};
const file = async (who, c, pledgeId, advisory, label, stake) => {
  const row = await write(c, who, "file_breach", [pledgeId, advisory], stake);
  if (row.returned?.startsWith("REFUNDED")) return null;
  const claimId = `claim_${nextClaim++}`;
  await ruling(claimId, label);
  return claimId;
};

// GEN transfers out of the contract (payouts, refunds) run as their own transactions once the call
// that emitted them is finalized, so compare balances only when nothing touching the contract is in flight.
const quiet = async () => {
  let last = -1;
  for (let i = 0; i < 60; i++) {
    const txs = await rpc("sim_getTransactionsForAddress", [CONTRACT]);
    const busy = txs.filter((t) => t.status !== "FINALIZED" && t.status !== "CANCELED" && t.status !== "UNDETERMINED").length;
    if (busy === 0 && txs.length === last) return;
    last = busy === 0 ? txs.length : -1;
    await sleep(10000);
  }
  throw new Error("transactions did not finalize");
};
const reconciliations = [];
const coverages = {};
const reconcile = async (label) => {
  await quiet();
  const t = JSON.parse(await read(P, "totals"));
  const onChain = await balance(CONTRACT);
  const ok = BigInt(t.expected_balance) === onChain;
  reconciliations.push({ label, bonds: t.bonds, pending_stakes: t.pending_stakes, expected: t.expected_balance, balance: onChain.toString(), ok });
  console.log(`  reconcile (${label}): active bonds ${fmt(t.bonds)} + open stakes ${fmt(t.pending_stakes)} = ${fmt(t.expected_balance)} GEN; contract balance ${fmt(onChain)} GEN ${ok ? "OK" : "MISMATCH"}`);
  if (!ok) throw new Error("balance mismatch");
};
const cover = async (pledgeId, label) => {
  coverages[label] = JSON.parse(await read(P, "coverage", [pledgeId]));
  console.log(`  coverage(${pledgeId}) = ${JSON.stringify(coverages[label])}`);
};

// Refused at pledging: a bond that does not cover every payout.
await write(P, "pledger", "create_pledge", ["npm", "next", "CRITICAL", 14, "", 2n * GEN, 3, acct.fund.address, "2026-09-01", "2027-08-31"], 4n * GEN);

// P0: Next.js, CRITICAL advisories within 14 days. Both advisories were fixed before they were published.
await write(P, "pledger", "create_pledge", ["npm", "next", "CRITICAL", 14, "", 2n * GEN, 2, acct.fund.address, "2026-09-01", "2027-08-31"], 6n * GEN);
await write(B, "bystander", "verify_maintainer", [pid(0)]); // vercel/next.js has no .patchpledge file listing this wallet
const s0 = BigInt(await read(P, "stake_for", [pid(0)]));
await write(R, "reporter", "file_breach", [pid(0), "GHSA-cjq9-62q9-8jv4"], GEN); // wrong stake: refunded
const c0 = await file("reporter", R, pid(0), "GHSA-cjq9-62q9-8jv4", "P0 next SSRF (HIGH) vs a CRITICAL-only pledge", s0);
await write(R, "reporter", "settle", [c0]); // the reporter accepts early; the stake goes to the bond
const c1 = await file("reporter", R, pid(0), "GHSA-2xp9-vwfh-vxw4", "P0 next RCE (CRITICAL)", s0);
await write(P, "pledger", "settle", [c1], 0n, { expectError: true }); // the pledger gains the stake: cannot rush it
await write(R, "reporter", "contest", [c1, ""]); // one fresh look for the reporter
await ruling(c1, "P0 after the reporter's contest");
await write(R, "reporter", "contest", [c1, ""], 0n, { expectError: true }); // once per side
await write(R, "reporter", "settle", [c1]);
await write(P, "pledger", "close_pledge", [pid(0)], 0n, { expectError: true }); // bond locked until coverage + SLA end

// P1: eazy-logger, HIGH within 30 days. The fix shipped 55 days after the advisory.
console.log("");
await write(P, "pledger", "create_pledge", ["npm", "eazy-logger", "HIGH", 30, "", 3n * GEN, 2, acct.fund.address, "2025-01-01", "2026-12-31"], 6n * GEN);
await write(K, "backer", "back_pledge", [pid(1)], 3n * GEN); // a company that depends on eazy-logger co-funds the pledge
await cover(pid(1), `${pid(1)} after a backer joined`);
const s1 = BigInt(await read(P, "stake_for", [pid(1)]));
const c2 = await file("reporter", R, pid(1), "GHSA-r7jx-5m6m-cpg9", "P1 eazy-logger prototype pollution", s1);
await write(R, "reporter", "settle", [c2], 0n, { expectError: true }); // the reporter gains from a payout
await write(F, "fund", "settle", [c2], 0n, { expectError: true }); // so does the beneficiary
await write(P, "pledger", "settle", [c2]); // the pledger concedes: 2.7 GEN to the fund, 0.3 + stake to the reporter
await write(R, "reporter", "file_breach", [pid(1), "GHSA-r7jx-5m6m-cpg9"], s1); // paid once: refunded

// P2: extract-zip, HIGH within 30 days, DoS excluded. The symlink file-write advisory has no fix.
console.log("");
await write(P, "pledger", "create_pledge", ["npm", "extract-zip", "HIGH", 30, NO_DOS, 3n * GEN, 1, acct.fund.address, "2026-01-01", "2027-06-30"], 3n * GEN);
const s2 = BigInt(await read(P, "stake_for", [pid(2)]));
const c3 = await file("reporter", R, pid(2), "GHSA-7pqw-9j4j-h8q3", "P2 extract-zip arbitrary file write", s2);
await write(R, "reporter", "file_breach", [pid(2), "GHSA-r7jx-5m6m-cpg9"], s2); // its only payout is reserved by the open claim: refunded
await cover(pid(2), `${pid(2)} with its only payout reserved`);
await reconcile("claim open on P2, payout reserved");
// The pledger answers with the package README, which gives no technical reason: the breach stands.
await write(P, "pledger", "contest", [c3, "https://raw.githubusercontent.com/max-mapper/extract-zip/master/readme.md"]);
await ruling(c3, "P2 after the pledger's contest with a statement");
await write(P, "pledger", "contest", [c3, ""], 0n, { expectError: true });

// P3: open-webui, HIGH within 30 days, DoS excluded. The advisory is a denial of service.
console.log("");
await write(P, "pledger", "create_pledge", ["npm", "open-webui", "HIGH", 30, NO_DOS, 2n * GEN, 1, acct.fund.address, "2025-01-01", "2026-12-31"], 4n * GEN);
const s3 = BigInt(await read(P, "stake_for", [pid(3)]));
const c4 = await file("reporter", R, pid(3), "GHSA-5ccf-884p-4jjq", "P3 open-webui multipart DoS", s3);
await write(P, "pledger", "contest", [c4, ""], 0n, { expectError: true }); // only the reporter contests a ruling that pays nothing
await write(R, "reporter", "contest", [c4, ""]);
await ruling(c4, "P3 after the reporter's contest");

// P4: Budibase, HIGH within 90 days. The advisory is from 2026-08-26, so it is not due yet.
console.log("");
await write(P, "pledger", "create_pledge", ["npm", "@budibase/server", "HIGH", 90, "", 2n * GEN, 2, acct.fund.address, "2026-01-01", "2027-12-31"], 4n * GEN);
const s4 = BigInt(await read(P, "stake_for", [pid(4)]));
await write(R, "reporter", "file_breach", [pid(4), "GHSA-6x9p-4r67-5gjx"], s4); // not due: refunded with the deadline

// P5: Next.js, CRITICAL within 14 days, for 2025. GHSA-9qr9-h5gf-34mp lists seven fixed versions; the earliest
// released one (16.0.7) sorts after the first six as text, so every reported fix must be checked to find it.
console.log("");
await write(P, "pledger", "create_pledge", ["npm", "next", "CRITICAL", 14, "", 2n * GEN, 2, acct.fund.address, "2025-01-01", "2026-12-31"], 4n * GEN);
const s5 = BigInt(await read(P, "stake_for", [pid(5)]));
const c5 = await file("reporter", R, pid(5), "GHSA-9qr9-h5gf-34mp", "P5 next, seven fixed branches", s5);
await write(R, "reporter", "settle", [c5]);

// After the response window, anyone settles the open claims.
console.log(`\nwaiting ${WINDOW_MS / 60000} minutes for the response window...`);
await write(B, "bystander", "settle", [c3], 0n, { expectError: true });
await reconcile("P2 and P3 claims open");
await sleep(WINDOW_MS + 30_000);
await write(B, "bystander", "settle", [c3]);
await write(B, "bystander", "settle", [c4]);

await sleep(8000);
await reconcile("end of run");
const end = Object.fromEntries(await Promise.all(Object.entries(acct).map(async ([k, a]) => [k, await balance(a.address)])));
console.log("\nfinal pledges:");
for (let n = 0; n < 6; n++) {
  const p = await read(P, "get_pledge", [pid(n)]);
  console.log(`  ${pid(n)} ${field(p, "ecosystem")}:${field(p, "package").padEnd(18)} bond=${fmt(field(p, "bond")).padStart(6)} paid=${fmt(field(p, "total_paid"))} kept=${field(p, "n_kept")} breached=${field(p, "n_breached")} other=${field(p, "n_other")} pending=${field(p, "pending")}`);
}
const evidence = {};
for (const id of [c0, c1, c2, c3, c4, c5]) {
  console.log(`  explain_claim(${id}) = ${await read(P, "explain_claim", [id])}`);
  const packets = JSON.parse(field(await read(P, "get_claim", [id]), "evidence_json"));
  evidence[id] = packets.map((e) => ({ packet_sha256: e.packet_sha256, read_at: e.read_at, osv: e.osv?.status, github: e.github?.status, osv_sha256: e.osv?.fields_sha256, github_sha256: e.github?.fields_sha256, deps_dev: e.deps_dev?.dates, second: e.second_source }));
}
const maintainer = JSON.parse(field(await read(P, "get_pledge", [pid(0)]), "maintainer_json"));
console.log(`  maintainer(${pid(0)}) = ${JSON.stringify(maintainer)}`);
console.log(`  covered_by(npm, next) = ${JSON.stringify(await read(P, "covered_by", ["npm", "next"]))}`);
console.log(`\nbalances: ${Object.keys(acct).map((k) => `${k} ${fmt(start[k])} -> ${fmt(end[k])}`).join(", ")} GEN`);
console.log("(transfers are emitted on finalization, so balances catch up once the appeal window closes)");
const out = { contract: CONTRACT, accounts: Object.fromEntries(Object.entries(acct).map(([k, a]) => [k, a.address])), pledges: [0, 1, 2, 3, 4, 5].map(pid), claims: [c0, c1, c2, c3, c4, c5], coverages, reconciliations, evidence, maintainer, log };
writeFileSync(new URL("../docs/demo-run.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("\nwrote docs/demo-run.json");
