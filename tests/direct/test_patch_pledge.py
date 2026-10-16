"""Direct-mode tests for the PatchPledge contract."""

import json
from datetime import datetime, timedelta, timezone

import pytest

from tests.direct.conftest import to_hex

CONTRACT_PATH = "contracts/patch_pledge.py"
GEN = 10**18
ADV = "GHSA-2xp9-vwfh-vxw4"
OSV_RE = rf"^https://api\.osv\.dev/v1/vulns/{ADV}$"
DEPS_RE = r"^https://api\.deps\.dev/v3/systems/npm/packages/left-pad/versions/(?P<v>[^/]+)$"
STATEMENT_URL = "https://example.org/left-pad/GHSA-2xp9.html"


def _osv(published="2026-03-01T10:00:00Z", severity="CRITICAL", fixed=("1.3.1",), name="left-pad",
         ecosystem="npm", withdrawn=None, adv=ADV):
    events = [{"introduced": "0"}] + [{"fixed": v} for v in fixed]
    record = {
        "id": adv,
        "summary": "Prototype pollution in left-pad",
        "details": "The pad() helper merges user options into Object.prototype.",
        "published": published,
        "database_specific": {"severity": severity},
        "affected": [{"package": {"ecosystem": ecosystem, "name": name}, "ranges": [{"type": "SEMVER", "events": events}]}],
    }
    if withdrawn:
        record["withdrawn"] = withdrawn
    return record


def _mock_json(direct_vm, pattern, body, status=200):
    direct_vm.mock_web(
        pattern,
        {
            "method": "GET",
            "response": {
                "status": status,
                "headers": {"Content-Type": b"application/json"},
                "body": json.dumps(body).encode() if body is not None else b"not found",
            },
        },
    )


def _setup(direct_vm, osv=None, osv_status=200, fixes=None, deps_status=200, answer="IN_SCOPE", statement=None):
    """Mock OSV, deps.dev (version -> publishedAt) and the model."""
    direct_vm.clear_mocks()
    _mock_json(direct_vm, OSV_RE, _osv() if osv is None else osv, osv_status)
    for version, when in (fixes or {}).items():
        _mock_json(
            direct_vm,
            rf"^https://api\.deps\.dev/v3/systems/npm/packages/left-pad/versions/{version.replace('.', r'\.')}$",
            {"publishedAt": when},
            deps_status,
        )
    if statement is not None:
        direct_vm.mock_web(
            rf"^{STATEMENT_URL.replace('.', r'\.')}$",
            {"method": "GET", "response": {"status": 200, "headers": {"Content-Type": b"text/html"}, "body": statement.encode()}},
        )
    direct_vm.mock_llm(r".*", json.dumps({"answer": answer}))


def _pledge(direct_vm, direct_deploy, pledger, payee, bond=10 * GEN, **terms):
    direct_vm.sender = pledger
    contract = direct_deploy(CONTRACT_PATH)
    args = dict(
        ecosystem="npm", package="left-pad", min_severity="HIGH", sla_days=14, scope="",
        payout=4 * GEN, beneficiary=to_hex(payee), coverage_start="2026-01-01", coverage_end="2027-12-31",
    )
    args.update(terms)
    direct_vm.value = bond
    pledge_id = contract.create_pledge(*args.values())
    direct_vm.value = 0
    return contract, pledge_id


def _file(direct_vm, contract, pledge_id, who, adv=ADV, stake=None, **setup):
    _setup(direct_vm, **setup)
    direct_vm.sender = who
    direct_vm.value = int(contract.stake_for(pledge_id)) if stake is None else stake
    result = contract.file_breach(pledge_id, adv)
    direct_vm.value = 0
    return result


def _expire(contract, claim_id):
    contract.claims[claim_id].window_from = "2000-01-01T00:00:00+00:00"


def _no_fix(**kw):
    return dict(osv=_osv(fixed=()), **kw)


# --- pledges -----------------------------------------------------------------


def test_create_pledge_records_terms(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    assert pledge_id == "pledge_0"
    p = contract.get_pledge(pledge_id)
    assert (p.ecosystem, p.package, p.min_severity, int(p.sla_days)) == ("npm", "left-pad", "HIGH", 14)
    assert int(p.bond) == 10 * GEN and int(p.payout) == 4 * GEN and p.state == "active"
    assert contract.stake_for(pledge_id) == str(4 * GEN // 10)
    assert contract.covered_by("NPM", "Left-Pad") == ["pledge_0"]
    assert contract.withdraw_after(pledge_id) == "2028-01-15"


@pytest.mark.parametrize(
    "terms,reason",
    [
        (dict(ecosystem="cargo"), "ecosystem must be npm or PyPI"),
        (dict(package="bad name!"), "is not a valid npm package name"),
        (dict(min_severity="LOW"), "min_severity must be MODERATE, HIGH or CRITICAL"),
        (dict(sla_days=0), "sla_days must be a whole number from 1 to 365"),
        (dict(sla_days=400), "sla_days must be a whole number from 1 to 365"),
        (dict(payout=GEN // 2), "payout must be at least 1 GEN"),
        (dict(beneficiary="nope"), "beneficiary must be a wallet address"),
        (dict(coverage_start="2026-1-1"), "coverage dates must be YYYY-MM-DD"),
        (dict(coverage_start="2027-01-01", coverage_end="2026-12-31"), "coverage_start must not be after coverage_end"),
        (dict(coverage_start="2020-01-01", coverage_end="2020-12-31"), "coverage_end is already in the past"),
        (dict(payout=11 * GEN), "the bond must cover at least one payout"),
    ],
)
def test_invalid_pledges_are_refunded(direct_vm, direct_deploy, direct_alice, direct_bob, terms, reason):
    contract, result = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, **terms)
    assert result.startswith("REFUNDED:") and reason in result
    assert contract.get_pledges(0, 10) == []


def test_pypi_names_are_normalised(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, ecosystem="pypi", package="Django_Rest.Framework")
    assert contract.get_pledge(pledge_id).ecosystem == "PyPI"
    assert contract.covered_by("PyPI", "django-rest-framework") == [pledge_id]


def test_only_the_pledger_adds_bond(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender, direct_vm.value = direct_bob, GEN
    assert contract.add_bond(pledge_id).startswith("REFUNDED: Only the pledger")
    direct_vm.sender = direct_alice
    assert contract.add_bond(pledge_id) == "added"
    assert int(contract.get_pledge(pledge_id).bond) == 11 * GEN


# --- rulings -----------------------------------------------------------------


def test_fix_within_the_deadline_is_kept(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, fixes={"1.3.1": "2026-03-05T08:00:00Z"})
    claim = contract.get_claim(claim_id)
    assert (claim.verdict, claim.code) == ("KEPT", "fixed_in_time")
    facts = json.loads(claim.facts_json)
    assert facts["first_fix"] == "1.3.1" and facts["deadline"] == "2026-03-15T10:00:00Z"
    assert "within the 14-day deadline" in claim.why
    assert contract.explain_claim(claim_id).startswith("KEPT: GHSA-2xp9-vwfh-vxw4 was published on 2026-03-01")


def test_fix_before_disclosure_is_kept(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, fixes={"1.3.1": "2026-02-20T08:00:00Z"})
    claim = contract.get_claim(claim_id)
    assert claim.verdict == "KEPT" and "released on 2026-02-20, before the advisory was published" in claim.why


def test_late_fix_is_a_breach(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, fixes={"1.3.1": "2026-03-20T08:00:00Z"})
    claim = contract.get_claim(claim_id)
    assert (claim.verdict, claim.code) == ("BREACHED", "late_fix")
    assert json.loads(claim.facts_json)["days_late"] == 5
    assert "5 days after the 14-day deadline" in claim.why


def test_earliest_fix_counts_across_branches(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(
        direct_vm, contract, pledge_id, direct_charlie, osv=_osv(fixed=("1.3.1", "2.0.4")),
        fixes={"1.3.1": "2026-04-01T00:00:00Z", "2.0.4": "2026-03-10T00:00:00Z"},
    )
    claim = contract.get_claim(claim_id)
    assert claim.verdict == "KEPT" and json.loads(claim.facts_json)["first_fix"] == "2.0.4"


def test_no_fix_after_the_deadline_is_a_breach(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, **_no_fix())
    claim = contract.get_claim(claim_id)
    assert (claim.verdict, claim.code) == ("BREACHED", "no_fix")
    assert "no fixed version of npm:left-pad is listed" in claim.why


def test_claim_before_the_deadline_is_refunded(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    result = _file(direct_vm, contract, pledge_id, direct_charlie, osv=_osv(published=yesterday, fixed=()))
    assert result.startswith("REFUNDED:") and "has not passed" in result
    assert contract.get_claims(0, 10) == [] and int(contract.get_pledge(pledge_id).pending) == 0


@pytest.mark.parametrize(
    "setup,verdict,code",
    [
        (dict(osv_status=404), "NOT_COVERED", "not_found"),
        (dict(osv_status=500), "UNCLEAR", "osv_unreachable"),
        (dict(osv=_osv(withdrawn="2026-03-02T00:00:00Z")), "NOT_COVERED", "withdrawn"),
        (dict(osv=_osv(name="right-pad")), "NOT_COVERED", "package"),
        (dict(osv=_osv(ecosystem="PyPI")), "NOT_COVERED", "package"),
        (dict(osv=_osv(severity="MODERATE")), "NOT_COVERED", "severity"),
        (dict(osv=_osv(severity="")), "UNCLEAR", "no_severity"),
        (dict(osv=_osv(published="2025-12-31T23:00:00Z")), "NOT_COVERED", "date"),
        (dict(fixes={"1.3.1": "2026-03-20T00:00:00Z"}, deps_status=503), "UNCLEAR", "registry_unreachable"),
    ],
)
def test_coverage_is_decided_in_code(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, setup, verdict, code):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, **setup)
    claim = contract.get_claim(claim_id)
    assert (claim.verdict, claim.code) == (verdict, code)
    assert claim.why


def test_missing_registry_date_is_unclear_not_a_breach(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    # 1.3.1 is late, 2.0.4's date cannot be read: it could have been on time, so no breach.
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(
        direct_vm, contract, pledge_id, direct_charlie, osv=_osv(fixed=("1.3.1", "2.0.4")),
        fixes={"1.3.1": "2026-04-01T00:00:00Z"},
    )
    assert contract.get_claim(claim_id).code == "registry_unreachable"


@pytest.mark.parametrize("answer,verdict,code", [("IN_SCOPE", "BREACHED", "no_fix"), ("OUT_OF_SCOPE", "EXCUSED", "scope"), ("UNCLEAR", "UNCLEAR", "scope_unclear")])
def test_scope_goes_to_the_model(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie, answer, verdict, code):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, scope="Runtime library only; the bundled CLI is excluded.")
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, answer=answer, **_no_fix())
    claim = contract.get_claim(claim_id)
    assert (claim.verdict, claim.code) == (verdict, code)
    assert json.loads(claim.facts_json)["scope_answer"] == answer
    if answer == "OUT_OF_SCOPE":
        assert claim.why.endswith("given its written scope.")


def test_scope_is_not_asked_when_the_fix_was_on_time(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, scope="Runtime only.")
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, answer="NOT_AN_ANSWER", fixes={"1.3.1": "2026-03-02T00:00:00Z"})
    assert contract.get_claim(claim_id).verdict == "KEPT"


def test_non_enum_model_answer_reverts(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, scope="Runtime only.")
    with direct_vm.expect_revert("LLM answer must be one of IN_SCOPE, OUT_OF_SCOPE, UNCLEAR"):
        _file(direct_vm, contract, pledge_id, direct_charlie, answer="MAYBE", **_no_fix())


# --- filing ------------------------------------------------------------------


def test_filing_input_is_checked_and_refunded(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    assert "exactly 400000000000000000 wei" in _file(direct_vm, contract, pledge_id, direct_charlie, stake=GEN, **_no_fix())
    assert "GitHub advisory id" in _file(direct_vm, contract, pledge_id, direct_charlie, adv="CVE-2026-1234", **_no_fix())
    assert "No pledge with id pledge_7" in _file(direct_vm, contract, "pledge_7", direct_charlie, stake=0, **_no_fix())
    assert contract.get_claims(0, 10) == []


def test_one_open_claim_per_advisory(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, **_no_fix())
    again = _file(direct_vm, contract, pledge_id, direct_bob, **_no_fix())
    assert again == f"REFUNDED: {claim_id} is already open for this advisory"


# --- settlement --------------------------------------------------------------


def test_breach_pays_beneficiary_and_reporter(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, **_no_fix())
    _expire(contract, claim_id)
    direct_vm.sender = direct_bob  # anyone may settle once the window has passed
    assert contract.settle(claim_id) == "paid"
    p, claim = contract.get_pledge(pledge_id), contract.get_claim(claim_id)
    assert int(p.bond) == 6 * GEN and int(p.total_paid) == 4 * GEN and int(p.n_breached) == 1 and int(p.pending) == 0
    settled = json.loads(claim.timeline_json)[-1]
    assert settled["beneficiary"] == str(36 * GEN // 10) and settled["reporter"] == str(4 * GEN // 10)
    assert claim.state == "settled" and json.loads(p.paid_json) == [ADV]
    assert "already been paid" in _file(direct_vm, contract, pledge_id, direct_charlie, **_no_fix())


def test_rejected_claim_stake_goes_to_the_bond(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, fixes={"1.3.1": "2026-03-02T00:00:00Z"})
    _expire(contract, claim_id)
    assert contract.settle(claim_id) == "stake_to_bond"
    p = contract.get_pledge(pledge_id)
    assert int(p.bond) == 10 * GEN + 4 * GEN // 10 and int(p.stakes_kept) == 4 * GEN // 10 and int(p.n_kept) == 1


def test_unclear_claim_returns_the_stake(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, osv_status=500)
    _expire(contract, claim_id)
    assert contract.settle(claim_id) == "stake_returned"
    assert int(contract.get_pledge(pledge_id).bond) == 10 * GEN


def test_payout_is_capped_by_the_bond(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob, bond=5 * GEN)
    first = _file(direct_vm, contract, pledge_id, direct_charlie, **_no_fix())
    _expire(contract, first)
    contract.settle(first)
    other = "GHSA-3g8h-86w9-wvmq"
    direct_vm.clear_mocks()
    _mock_json(direct_vm, rf"^https://api\.osv\.dev/v1/vulns/{other}$", _osv(fixed=(), adv=other))
    direct_vm.sender, direct_vm.value = direct_charlie, 4 * GEN // 10
    second = contract.file_breach(pledge_id, other)
    direct_vm.value = 0
    _expire(contract, second)
    contract.settle(second)
    p = contract.get_pledge(pledge_id)
    assert int(p.bond) == 0 and int(p.total_paid) == 5 * GEN
    assert "no bond left" in _file(direct_vm, contract, pledge_id, direct_charlie, adv="GHSA-36qx-fr4f-26g5", **_no_fix())


# --- who may act, and when (adversarial) -------------------------------------


def test_only_the_pledger_can_concede_a_breach_early(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, **_no_fix())
    for who in (direct_charlie, direct_bob):  # the claimant and the beneficiary gain from a payout
        direct_vm.sender = who
        with direct_vm.expect_revert("only the pledger can concede early"):
            contract.settle(claim_id)
    direct_vm.sender = direct_alice
    assert contract.settle(claim_id) == "paid"


def test_only_the_claimant_can_accept_a_rejection_early(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, fixes={"1.3.1": "2026-03-02T00:00:00Z"})
    direct_vm.sender = direct_alice  # the pledger gains the stake
    with direct_vm.expect_revert("only the claimant can accept early"):
        contract.settle(claim_id)
    direct_vm.sender = direct_charlie
    assert contract.settle(claim_id) == "stake_to_bond"
    with direct_vm.expect_revert("This claim is already settled"):
        contract.settle(claim_id)


def test_only_the_pledger_contests_a_breach(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    breach = _file(direct_vm, contract, pledge_id, direct_charlie, **_no_fix())
    for who in (direct_charlie, direct_bob):
        direct_vm.sender = who
        with direct_vm.expect_revert("Only the pledger can contest a breach"):
            contract.contest(breach, "")


def test_only_the_claimant_contests_a_rejection(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract2, pledge2 = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    kept = _file(direct_vm, contract2, pledge2, direct_charlie, fixes={"1.3.1": "2026-03-02T00:00:00Z"})
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Only the claimant can contest a ruling that pays nothing"):
        contract2.contest(kept, "")
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("Only the pledger can attach a statement"):
        contract2.contest(kept, STATEMENT_URL)


def test_pledger_statement_can_excuse_and_the_claimant_answers_once(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, **_no_fix())
    contract.claims[claim_id].window_from = old_window = datetime.now(timezone.utc).isoformat()
    _setup(direct_vm, answer="OUT_OF_SCOPE", statement="<p>pad() never touches Object.prototype since 1.0; the advisory tests a fork.</p>", **_no_fix())
    direct_vm.sender = direct_alice
    assert contract.contest(claim_id, STATEMENT_URL) == "EXCUSED"
    claim = contract.get_claim(claim_id)
    assert claim.statement_url == STATEMENT_URL and claim.window_from != old_window
    assert claim.why.endswith("given the pledger's statement.")
    with direct_vm.expect_revert("Only the claimant can contest a ruling that pays nothing"):
        contract.contest(claim_id, "")
    # the claimant gets one fresh look; the statement still counts and the model now disagrees
    _setup(direct_vm, answer="IN_SCOPE", statement="<p>We disagree.</p>", **_no_fix())
    direct_vm.sender = direct_charlie
    assert contract.contest(claim_id, "") == "BREACHED"
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("The pledger has already contested this claim"):
        contract.contest(claim_id, "")
    steps = [s["event"] for s in json.loads(contract.get_claim(claim_id).timeline_json)]
    assert steps == ["filed", "contested", "contested"]


def test_statement_url_must_be_https(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, **_no_fix())
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("statement_url must be an https:// link"):
        contract.contest(claim_id, "http://example.org/x")


def test_window_closes_for_contests(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, **_no_fix())
    _expire(contract, claim_id)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("The response window has closed"):
        contract.contest(claim_id, "")


def test_bond_is_locked_until_the_last_sla_and_open_claims(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, **_no_fix())
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only the pledger can withdraw the bond"):
        contract.withdraw(pledge_id)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("The bond stays until 2028-01-15"):
        contract.withdraw(pledge_id)
    # coverage ended long ago, but the claim is still open
    contract.pledges[pledge_id].coverage_end = "2026-01-31"
    with direct_vm.expect_revert("Settle the open claims first"):
        contract.withdraw(pledge_id)
    _expire(contract, claim_id)
    contract.settle(claim_id)
    assert contract.withdraw(pledge_id) == str(6 * GEN)
    p = contract.get_pledge(pledge_id)
    assert p.state == "closed" and int(p.bond) == 0
    assert contract.covered_by("npm", "left-pad") == []
    assert "This pledge is closed" in _file(direct_vm, contract, pledge_id, direct_charlie, adv="GHSA-36qx-fr4f-26g5", stake=0, **_no_fix())


# --- views -------------------------------------------------------------------


def test_registry_reads_in_one_call(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    contract, pledge_id = _pledge(direct_vm, direct_deploy, direct_alice, direct_bob)
    direct_vm.sender, direct_vm.value = direct_alice, 3 * GEN
    contract.create_pledge("PyPI", "requests", "CRITICAL", 30, "", GEN, to_hex(direct_bob), "2026-01-01", "2027-01-01")
    direct_vm.value = 0
    claim_id = _file(direct_vm, contract, pledge_id, direct_charlie, **_no_fix())
    assert [p.id for p in contract.get_pledges(0, 200)] == ["pledge_0", "pledge_1"]
    assert [p.id for p in contract.get_pledges(1, 5)] == ["pledge_1"]
    assert [c.id for c in contract.get_claims(0, 200)] == [claim_id]
    assert json.loads(contract.get_pledge(pledge_id).claim_ids_json) == [claim_id]
    assert contract.response_window_seconds() == 600
    with direct_vm.expect_revert("No claim with id claim_9"):
        contract.get_claim("claim_9")
