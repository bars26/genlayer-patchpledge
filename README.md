# PatchPledge

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/license/mit/)

<img src="assets/patchpledge-logo.png" alt="PatchPledge logo" width="96" align="right" />

**Security patch promises for npm and PyPI packages, backed by GEN and ruled by GenLayer validators.**

Almost every package you install makes no promise about how fast a security hole gets fixed. Companies that depend on
open source would happily pay for one, and maintainers who already ship fast have no way to prove it. PatchPledge turns
"we fix serious advisories within N days" into a bond:

1. A **pledger** (the maintainer, or a company that depends on the package) bonds GEN and fixes the terms: the package,
   the minimum severity covered, the fix deadline in days, the coverage period, the payout per breach, a **beneficiary**
   wallet (for example a users' security fund) and, optionally, a plain-language **scope** ("denial-of-service is excluded").
2. When an advisory goes past its deadline, **anyone reports it** with the GitHub advisory id, staking 10% of the payout.
3. **Every GenLayer validator** reads the advisory from [OSV](https://osv.dev) and the release date of each fixed version
   from [deps.dev](https://deps.dev), and applies the same rules in code. A language model is asked one narrow question,
   and only when the deadline was missed and the pledge has a scope or the pledger sent a statement: is this advisory
   inside what was promised?
4. The side the ruling goes against has 10 minutes to **contest once** (the pledger may attach a statement link). Every
   contest restarts the window, so the other side can answer.
5. A **breach pays** the beneficiary 90% of the payout and the reporter 10% plus their stake. A kept promise keeps the
   reporter's stake in the bond. If a source cannot be read, nothing is paid and the stake goes back.

Every ruling stores a plain-English **reason** built only from facts all validators agreed on (`explain_claim`), and a
**timeline** of who did what. Anyone can ask `covered_by("npm", "next")` to see whether a dependency is covered.

**Live app:** [patchpledge-bars26.vercel.app](https://patchpledge-bars26.vercel.app). Browsing needs no wallet. Writes need
MetaMask on GenLayer Studio (chain 61999); the **Test GEN** button funds your wallet from the Studio faucet.
**Demo video (30 s):** [youtu.be/rspweMSn_mA](https://youtu.be/rspweMSn_mA).
**Contract:** [`0x3d85a84149c05EBc16fD11A358f26473901afbB8`](https://explorer-studio.genlayer.com/address/0x3d85a84149c05EBc16fD11A358f26473901afbB8) on GenLayer Studio.

## Verified live, on real advisories

`scripts/demo.mjs` ran five demo pledges (made by a test wallet, not by the maintainers) against real GitHub advisories
with real validator consensus, OSV and deps.dev reads, and LLM calls. Every transaction hash is in
[`docs/REPRODUCTION.md`](docs/REPRODUCTION.md).

| Pledge | Advisory (real) | What validators read | Ruling | What happened |
|---|---|---|---|---|
| `next`, CRITICAL within 14 days | GHSA-cjq9-62q9-8jv4 (SSRF) | rated HIGH | **NOT_COVERED** (severity) | reporter accepted early; stake added to the bond |
| `next`, CRITICAL within 14 days | GHSA-2xp9-vwfh-vxw4 (RCE) | published 2026-09-08, fix 16.3.3 released 2026-08-25 | **KEPT** | pledger tried to settle early: refused; reporter contested once: KEPT again; second contest refused |
| `eazy-logger`, HIGH within 30 days | GHSA-r7jx-5m6m-cpg9 | published 2025-02-06, first fix 4.1.0 on 2025-04-02 | **BREACHED** (late fix, 26 days late) | reporter and beneficiary tried to settle early: refused; pledger conceded: 2.7 GEN to the fund, 0.3 GEN + stake to the reporter; refiling refused (paid once) |
| `extract-zip`, HIGH within 30 days, DoS excluded | GHSA-7pqw-9j4j-h8q3 (symlink file write) | published 2026-08-17, no fix listed | **BREACHED** (no fix; scope: IN_SCOPE) | pledger contested with the package README as a "statement": still BREACHED; a bystander could not settle early, settled after the window |
| `open-webui`, HIGH within 30 days, DoS excluded | GHSA-5ccf-884p-4jjq (multipart DoS) | published 2025-03-20, no fix listed | **EXCUSED** (scope: OUT_OF_SCOPE) | pledger could not contest a ruling in its favour; reporter contested once: EXCUSED again; settled after the window |
| `@budibase/server`, HIGH within 90 days | GHSA-6x9p-4r67-5gjx | published 2026-08-26, deadline 2026-11-24 | not due | refunded with the deadline in the message, no claim opened |

Also refused on-chain in that run: a claim with the wrong stake (refunded), and the pledger withdrawing a bond before
coverage plus one deadline had passed.

## Rules (all in code except the scope question)

| Ruling | When |
|---|---|
| `NOT_COVERED` | advisory not in OSV, withdrawn, does not list this package, below the severity floor, or published outside the coverage dates |
| `KEPT` | the first fixed version (OSV) was released (deps.dev) on or before publication + deadline; a fix shipped before disclosure counts |
| not due | no fix and the deadline has not passed: the claim is refunded, not opened |
| `BREACHED` | first fix after the deadline, or deadline passed with no fix, and (if there is a scope or statement) validators answered `IN_SCOPE` |
| `EXCUSED` | deadline missed, but validators answered `OUT_OF_SCOPE`: the advisory is outside the written scope, or the pledger's statement shows specifically why the package is not affected |
| `UNCLEAR` | OSV or a release date could not be read, the advisory has no severity, or the scope answer was `UNCLEAR` |

A fixed version whose release date cannot be read makes the ruling `UNCLEAR`, never `BREACHED`: that version might have
been on time. The model's answer must be exactly `IN_SCOPE`, `OUT_OF_SCOPE` or `UNCLEAR`, and validators must agree
exactly (`strict_eq` on the whole result, facts included).

## Who can do what (and the attacks this blocks)

- **Only the side a ruling goes against contests**, once per side: the pledger contests a breach, the reporter contests
  anything else. Each contest re-runs the whole assessment and restarts the window.
- **Early settlement only against your own interest:** the pledger can concede a breach, the reporter can accept a ruling
  that pays nothing. The reporter or beneficiary cannot rush a payout, and the pledger cannot rush taking a stake.
- **No escaping by ending coverage:** the bond stays locked until coverage end + one full deadline and until every open
  claim is settled, so an advisory published on the last covered day still gets its full deadline.
- **One open claim per advisory, one payout per advisory** per pledge. Payouts are capped by the bond.
- **Payable calls never revert** (GenLayer keeps a reverted call's value): an invalid pledge, a wrong stake, a not-yet-due
  or duplicate claim returns `REFUNDED: <reason>` and sends the GEN back.
- Payouts use an external EVM transfer to the wallet (an internal GenVM message to a wallet never delivers).

## The app and Studio's rate limit

GenLayer Studio allows 30 contract reads and sends per minute per IP. The app spends none of that on page loads:

- `/api/registry` reads every pledge and claim **server-side** with one `get_pledges` and one `get_claims` call per 200
  items, cached at the CDN (15 s, short stale-while-revalidate).
- Writes re-read only the pledge or claim they touched.
- The browser keeps a 24-per-minute budget of its own and shows it under **Your transactions**; when it is spent, the next
  call waits and says how long, instead of failing.
- `/api/precheck` previews a claim's likely ruling from the same OSV and deps.dev data before the reporter stakes anything.

Every write shows its hash, consensus status and the contract's own execution result; a refused call shows the exact
contract message.

## Run it

```bash
pip install -r requirements.txt
genvm-lint check contracts/patch_pledge.py
pytest tests/direct/ -v                     # 50 tests, OSV / deps.dev / LLM mocked

npm install
node scripts/deploy.mjs                     # deploy to GenLayer Studio
node scripts/verify-code.mjs <address>      # deployed code == contracts/patch_pledge.py
node scripts/demo.mjs <address>             # the live run above (about 20 minutes)
node scripts/reproduction.mjs               # regenerate docs/REPRODUCTION.md

cd frontend && cp .env.example .env.local && npm run dev
```

## Limits, stated plainly

- The contract does not verify that a pledger is the package's maintainer; a pledge is a promise backed by the pledger's
  own GEN, which is also how a sponsor can back a dependency it uses. Verifying maintainers (for example a pledge id
  published in the package metadata) is planned.
- Only GitHub advisories (GHSA ids) for npm and PyPI. Severity is GitHub's label as published in OSV.
- "Fixed" means a release listed as fixed in OSV exists; it does not prove the fix is complete. A later advisory for an
  incomplete fix is a new advisory.
- The response window is 10 minutes so the flow can be tested in one sitting; a production deployment would use days.

## Repository

```
contracts/patch_pledge.py     the Intelligent Contract
tests/direct/                 50 direct-mode tests (rules, money, who-can-act, refusals)
scripts/                      deploy, verify-code, live demo, reproduction log
frontend/                     Next.js app (light "paper and ink" theme)
docs/REPRODUCTION.md          the live run with every transaction hash
```

MIT licensed.
