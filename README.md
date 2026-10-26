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
**Contract (v2):** [`0x6d466b1C122c951edD2403BCDd5D22556BcF6A5a`](https://explorer-studio.genlayer.com/address/0x6d466b1C122c951edD2403BCDd5D22556BcF6A5a) on GenLayer Studio
(the v1 contract and its run are in [`docs/REPRODUCTION-v1.md`](docs/REPRODUCTION-v1.md)).

## What v2 adds

| | v1 | v2 |
|---|---|---|
| Advisory source | OSV only | **OSV and the GitHub Advisory Database.** "Not found" only when both say so; a source that is down or rate-limited decides nothing; if they rate the severity differently, nothing is decided; fixed versions are the union of both; the later publication date sets the deadline (the more lenient one) |
| Release dates | deps.dev only | deps.dev, and the **deciding release date is confirmed by a second, independent source**: PyPI itself, or ecosyste.ms for npm (npm's own document for a large package is tens of megabytes). More than a day apart, or unreadable: `UNCLEAR`, the stake goes back. Kept and breached rulings both need it |
| Who pledged | anyone, unverified | **Verified maintainer:** `verify_maintainer(pledge_id)` (anyone can run it) has validators find the package's GitHub repository through npm or PyPI and read its `.patchpledge` file. If the file lists the pledger's wallet, the pledge is shown as made by a verified maintainer; otherwise it is a sponsor pledge, with the reason (no repository, no file, wallet not listed) |
| Money in | the pledger only | **Backers:** `back_pledge` lets anyone who depends on the package add GEN to a pledge. `close_pledge` (anyone, after coverage end + one deadline, no open claims) returns what is left of the bond, kept stakes included, to every backer pro rata |
| Payout guarantee | each breach paid `min(payout, bond)` | **Always in full:** the pledge sets `max_payouts`, the bond must be at least payout × max_payouts, and each open claim reserves a payout. A claim that would exceed the remaining payouts is refunded before anything is staked |
| Evidence | facts and reason | plus an **evidence packet per assessment**: each source's fields with sha256 hashes, the release dates from both sources, the statement's hash and excerpt, and a packet hash recorded in the claim's timeline. `coverage()` and `totals()` views; the live run reconciles `totals()` with the contract's real balance |
| Tests | 55 | **78** |

## Verified live, on real advisories

`scripts/demo.mjs` ran six demo pledges (made by a test wallet, not by the maintainers) against real GitHub advisories
with real validator consensus, OSV, GitHub, deps.dev and ecosyste.ms reads, and LLM calls. Every transaction hash, the
coverage reads, the balance reconciliation and every evidence packet are in [`docs/REPRODUCTION.md`](docs/REPRODUCTION.md).

| Pledge | Advisory (real) | What validators read | Ruling | What happened |
|---|---|---|---|---|
| `next`, CRITICAL within 14 days, pays at most 2 | GHSA-cjq9-62q9-8jv4 (SSRF) | OSV and GitHub both rate it HIGH | **NOT_COVERED** (severity) | reporter accepted early; stake added to the bond. `verify_maintainer`: repository vercel/next.js has no `.patchpledge` file, so a sponsor pledge |
| same | GHSA-2xp9-vwfh-vxw4 (RCE) | published 2026-09-08; fix 16.3.3 released 2026-08-25 per deps.dev and ecosyste.ms | **KEPT** | pledger tried to settle early: refused; reporter contested once: KEPT again; second contest refused |
| `eazy-logger`, HIGH within 30 days, pays at most 2, **backed by a second wallet** | GHSA-r7jx-5m6m-cpg9 | published 2025-02-06; first fix 4.1.0 on 2025-04-02, confirmed by ecosyste.ms | **BREACHED** (late fix, 26 days late) | a backer added 3 GEN; reporter and beneficiary could not settle early; pledger conceded: paid in full, 2.7 GEN to the fund, 0.3 GEN + stake to the reporter; refiling refused (paid once) |
| `extract-zip`, HIGH within 30 days, DoS excluded, **pays at most 1**, bond exactly 1 × payout | GHSA-7pqw-9j4j-h8q3 (symlink file write) | published 2026-08-17; neither OSV nor GitHub lists a fix | **BREACHED** (no fix; scope: IN_SCOPE) | a second claim was refunded while this one held the only payout; pledger contested with the README as a "statement": still BREACHED; settled by a bystander after the window, paid in full |
| `open-webui`, HIGH within 30 days, DoS excluded | GHSA-5ccf-884p-4jjq (multipart DoS) | published 2025-03-20, no fix listed | **EXCUSED** (scope: OUT_OF_SCOPE) | pledger could not contest a ruling in its favour; reporter contested once: EXCUSED again; settled after the window |
| `@budibase/server`, HIGH within 90 days | GHSA-6x9p-4r67-5gjx | published 2026-08-26, deadline 2026-11-24 | not due | refunded with the deadline in the message, no claim opened |
| `next`, CRITICAL within 14 days, 2025 | GHSA-9qr9-h5gf-34mp | seven fixed versions; the earliest released, 16.0.7, on 2025-12-03, confirmed by ecosyste.ms | **KEPT** | every reported fix checked, not only the first six sorted as text |

Also refused on-chain in that run: a bond below payout × max_payouts, a claim with the wrong stake (refunded), and
closing a pledge before coverage plus one deadline had passed. The contract's balance matched `totals()` at three points
of the run, each read after every transfer had finalized.

## Rules (all in code except the scope question)

| Ruling | When |
|---|---|
| `NOT_COVERED` | advisory in neither OSV nor GitHub, withdrawn in either, does not list this package, below the severity floor, or published outside the coverage dates |
| `KEPT` | the earliest-released of **all** fixed versions OSV and GitHub report was released (deps.dev, confirmed by a second source) on or before publication + deadline; a fix shipped before disclosure counts |
| not due | no fix and the deadline has not passed: the claim is refunded, not opened |
| `BREACHED` | first fix after the deadline, or deadline passed with no fix, and (if there is a scope or statement) validators answered `IN_SCOPE` |
| `EXCUSED` | deadline missed, but validators answered `OUT_OF_SCOPE`: the advisory is outside the written scope, or the pledger's statement shows specifically why the package is not affected |
| `UNCLEAR` | an advisory source or a release date could not be read, the sources disagree (severity, or the deciding release date by more than a day), the advisory has no severity, or the scope answer was `UNCLEAR` |

Every fixed version the advisory reports is checked, on every branch: one deps.dev request returns the package's whole
version list with publish dates, and the ruling uses the earliest-released fix. (The first deployment sorted fixed
versions as text and only looked at six; a steward caught it. `test_earliest_fix_outside_the_first_six_counts` and
`test_per_version_fallback_when_the_listing_is_down` reproduce that case: on the old code the claim was ruled
`BREACHED`, now it is `KEPT`.) If the listing cannot be read, each fixed version is looked up on its own, up to 25; a
fixed version whose release date cannot be read makes the ruling `UNCLEAR`, never `BREACHED`: that version might have
been on time. The model's answer must be exactly `IN_SCOPE`, `OUT_OF_SCOPE` or `UNCLEAR`, and validators must agree
exactly (`strict_eq` on the whole result, facts included).

## Who can do what (and the attacks this blocks)

- **Only the side a ruling goes against contests**, once per side: the pledger contests a breach, the reporter contests
  anything else. Each contest re-runs the whole assessment and restarts the window.
- **Early settlement only against your own interest:** the pledger can concede a breach, the reporter can accept a ruling
  that pays nothing. The reporter or beneficiary cannot rush a payout, and the pledger cannot rush taking a stake.
- **No escaping by ending coverage:** the bond stays locked until coverage end + one full deadline and until every open
  claim is settled, so an advisory published on the last covered day still gets its full deadline.
- **One open claim per advisory, one payout per advisory** per pledge, at most `max_payouts` in all, each reserved
  while its claim is open and always paid in full.
- **Anyone can back a pledge and anyone can close it** once it has matured; backers get the rest of the bond pro rata.
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
pytest tests/direct/ -v                     # 78 tests, OSV / GitHub / deps.dev / PyPI / ecosyste.ms / LLM mocked

npm install
node scripts/deploy.mjs                     # deploy to GenLayer Studio
node scripts/verify-code.mjs <address>      # deployed code == contracts/patch_pledge.py
node scripts/demo.mjs <address>             # the live run above (about 20 minutes)
node scripts/reproduction.mjs               # regenerate docs/REPRODUCTION.md

cd frontend && cp .env.example .env.local && npm run dev
```

## Limits, stated plainly

- A maintainer is verified through the repository the package's registry entry points to; a registry entry can point
  anywhere, so the badge means "controls the linked repository". Unverified pledges are sponsor pledges, still backed
  by real GEN.
- Only GitHub advisories (GHSA ids) for npm and PyPI. OSV copies GitHub's severity label, so the two sources mostly
  agree; the GitHub check matters most when OSV is down or lags.
- The second release-date source is checked for the deciding release only (the earliest fix per deps.dev).
- "Fixed" means a release listed as fixed in OSV exists; it does not prove the fix is complete. A later advisory for an
  incomplete fix is a new advisory.
- The response window is 10 minutes so the flow can be tested in one sitting; a production deployment would use days.

## Repository

```
contracts/patch_pledge.py     the Intelligent Contract
tests/direct/                 55 direct-mode tests (rules, money, who-can-act, refusals)
scripts/                      deploy, verify-code, live demo, reproduction log
frontend/                     Next.js app (light "paper and ink" theme)
docs/REPRODUCTION.md          the live run with every transaction hash
```

MIT licensed.
