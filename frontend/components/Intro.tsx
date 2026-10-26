"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, FileWarning, HandCoins, Scale, X } from "lucide-react";

const STEPS = [
  {
    icon: HandCoins,
    title: "1. Someone pledges",
    body: "A maintainer, or a company that depends on the package, locks GEN behind a promise: “security advisories rated HIGH or above get a fix within 14 days.”",
  },
  {
    icon: FileWarning,
    title: "2. Anyone reports a miss",
    body: "If an advisory went past its deadline with no fix, anyone can report it by quoting its GitHub advisory id and staking 10% of the payout.",
  },
  {
    icon: Scale,
    title: "3. Validators rule",
    body: "GenLayer validators each read the advisory from OSV and GitHub and the release dates from two sources, and must agree. Every ruling comes with its reason.",
  },
  {
    icon: BadgeCheck,
    title: "4. Money moves",
    body: "A broken promise pays the beneficiary (for example the users' security fund) and rewards the reporter. A kept promise keeps the reporter's stake.",
  },
];

const SEEN_KEY = "patchpledge:intro-dismissed";

/** First-visit explainer: what this is, in four steps, before any jargon. */
export function Intro() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN_KEY) === "1") setOpen(false);
    } catch {
      // storage blocked: keep showing it
    }
  }, []);
  const dismiss = () => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // ignore
    }
  };

  return (
    <section className="mb-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
        <div className="lg:col-span-7 space-y-4">
          <p className="mono text-xs font-medium uppercase tracking-widest text-primary">Open-source security, with a deadline that pays</p>
          <h1 className="text-3xl md:text-4xl xl:text-5xl font-bold leading-tight">
            A promise to patch,
            <br />
            backed by money.
          </h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-2xl">
            Most packages you install make no promise about how fast security holes get fixed. On PatchPledge a maintainer or sponsor
            puts GEN behind one. If a serious advisory stays unfixed past the deadline, the bond pays out, decided by GenLayer
            validators from public data, not by either side.
          </p>
        </div>
        <div className="lg:col-span-5">
          <div className="brand-card p-4 text-sm space-y-2">
            <p className="font-semibold">Who is who</p>
            <ul className="space-y-1.5 text-muted-foreground">
              <li><strong className="text-foreground">Pledger</strong> · bonds the GEN and makes the promise (a verified maintainer or a sponsor).</li>
              <li><strong className="text-foreground">Backer</strong> · a company that depends on the package and adds GEN; gets its share back at closing.</li>
              <li><strong className="text-foreground">Reporter</strong> · anyone who spots a missed deadline and files it.</li>
              <li><strong className="text-foreground">Beneficiary</strong> · the wallet a broken promise pays, chosen by the pledger.</li>
            </ul>
          </div>
        </div>
      </div>

      {open && (
        <div className="mt-6 rounded-xl border border-primary/30 bg-[#E3F4EE]/60 p-4 md:p-5 relative">
          <button type="button" onClick={dismiss} aria-label="Hide the introduction" className="absolute right-3 top-3 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
          <p className="font-semibold mb-3">New here? How it works in 4 steps</p>
          <ol className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {STEPS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center gap-2 font-semibold mb-1">
                  <Icon className="w-4 h-4 text-primary shrink-0" />
                  {title}
                </div>
                <p className="text-sm text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted-foreground">
            You can browse everything without a wallet. To act, connect MetaMask and press <strong>Test GEN</strong> for free GenLayer Studio
            tokens. The pledges listed now are demo pledges made by test wallets, not by the real maintainers.
          </p>
        </div>
      )}
    </section>
  );
}
