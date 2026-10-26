"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { Intro } from "@/components/Intro";
import { Navbar } from "@/components/Navbar";
import { PledgeCard } from "@/components/PledgeCard";
import { PackageLookup, StatsPanel } from "@/components/SidePanels";
import { TransactionPanel } from "@/components/TransactionPanel";
import { Button } from "@/components/ui/button";
import { useRegistry } from "@/lib/hooks/usePatchPledge";

const RULES = [
  ["Not covered", "The advisory does not list this package, is below the severity floor, was published outside the coverage dates, or was withdrawn."],
  ["Kept", "The first fixed version (from OSV and GitHub) was released on or before publication + deadline, per deps.dev and confirmed by a second source (PyPI itself or ecosyste.ms). A fix shipped before the advisory went public counts."],
  ["Not due", "No fix yet, but the deadline has not passed. The contract refunds the reporter instead of opening a claim."],
  ["Breached", "The first fix came after the deadline, or the deadline passed with no fix. If the pledge has a written scope, validators first judge whether the advisory falls inside it."],
  ["Excused", "The deadline was missed, but validators judged the advisory outside the written scope, or the pledger's statement showed specifically why the package is not affected."],
  ["Unclear", "A source could not be read, two sources disagreed (severity, or the release date by more than a day), or the scope could not be judged. Nothing is paid and the reporter's stake comes back."],
];

export default function HomePage() {
  const { pledges, claims, isLoading, isError, error, isFetching, refetch, fetchedAt } = useRegistry();
  const ordered = [...pledges].sort((a, b) => Number(b.id.split("_")[1]) - Number(a.id.split("_")[1]));

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-grow pt-24 pb-12 px-4 md:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <Intro />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
            <div className="lg:col-span-8 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">Pledges</h2>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {fetchedAt && <span>updated {new Date(fetchedAt).toLocaleTimeString()}</span>}
                  <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh">
                    {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              {isLoading && <p className="text-sm text-muted-foreground">Reading the registry from GenLayer Studio…</p>}
              {isError && (
                <div className="rounded-lg border border-[#F4C7C1] bg-[#FDECEA] p-3 text-sm">
                  Could not read the registry: {error?.message}. GenLayer Studio may be busy; try Refresh in a minute.
                </div>
              )}
              {!isLoading && !isError && ordered.length === 0 && <p className="text-sm text-muted-foreground">No pledges yet. Be the first with “Make a pledge”.</p>}
              {ordered.map((p) => (
                <div id={p.id} key={p.id}>
                  <PledgeCard pledge={p} claims={claims.filter((c) => c.pledge_id === p.id)} />
                </div>
              ))}
            </div>
            <aside className="lg:col-span-4 space-y-6">
              <StatsPanel />
              <PackageLookup />
              <TransactionPanel />
            </aside>
          </div>

          <section className="mt-10 brand-card p-6 md:p-8">
            <h2 className="text-2xl font-bold mb-1">How a ruling is made</h2>
            <p className="text-sm text-muted-foreground mb-5 max-w-3xl">
              Every validator reads the advisory from <strong>OSV</strong> and the <strong>GitHub Advisory Database</strong>, the release date of each fixed version
              from <strong>deps.dev</strong>, and confirms the deciding date with a second source (<strong>PyPI</strong> itself or <strong>ecosyste.ms</strong>). It applies the
              same rules in code and must reach exactly the same result; when two sources disagree, nothing is decided. A language model is only asked one narrow question, and only when a deadline was
              missed and the pledge has a written scope or the pledger sent a statement: is this advisory inside what was promised?
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 text-sm">
              {RULES.map(([t, d]) => (
                <div key={t} className="rounded-lg border border-border p-4">
                  <p className="font-semibold mb-1">{t}</p>
                  <p className="text-muted-foreground">{d}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mt-6">
              <div>
                <p className="font-semibold mb-1">Response window</p>
                <p className="text-muted-foreground">After a ruling, the side it goes against has 10 minutes to contest once. The pledger may attach a statement link. Each contest restarts the window so the other side can answer.</p>
              </div>
              <div>
                <p className="font-semibold mb-1">Who can settle early</p>
                <p className="text-muted-foreground">Only the side that loses by settling: the pledger can concede a breach, the reporter can accept a ruling that pays nothing. After the window, anyone can settle.</p>
              </div>
              <div>
                <p className="font-semibold mb-1">Money</p>
                <p className="text-muted-foreground">A pledge pays at most a set number of breaches and its bond covers all of them, so every breach is paid in full: 90% to the beneficiary, 10% plus the stake to the reporter. Companies that depend on the package can back a pledge; at closing, what is left returns to every backer pro rata. The bond is locked until coverage ends plus one full deadline.</p>
              </div>
              <div>
                <p className="font-semibold mb-1">Verified maintainer</p>
                <p className="text-muted-foreground">Anyone can ask validators to check the package&apos;s GitHub repository (found through npm or PyPI) for a <span className="mono">.patchpledge</span> file listing the pledger&apos;s wallet. If it is there, the pledge is marked as made by a verified maintainer; otherwise it is a sponsor pledge.</p>
              </div>
            </div>
          </section>
        </div>
      </main>
      <footer className="border-t border-border py-4 text-center text-sm text-muted-foreground">
        Data: <a href="https://osv.dev" target="_blank" rel="noopener noreferrer" className="hover:text-primary">OSV</a>,{" "}
        <a href="https://github.com/advisories" target="_blank" rel="noopener noreferrer" className="hover:text-primary">GitHub Advisory Database</a>,{" "}
        <a href="https://ecosyste.ms" target="_blank" rel="noopener noreferrer" className="hover:text-primary">ecosyste.ms</a> and{" "}
        <a href="https://deps.dev" target="_blank" rel="noopener noreferrer" className="hover:text-primary">deps.dev</a>
        {" · "}
        <a href="https://genlayer.com" target="_blank" rel="noopener noreferrer" className="hover:text-primary">Built on GenLayer</a>
        {" · "}
        <a href="https://github.com/bars26/genlayer-patchpledge" target="_blank" rel="noopener noreferrer" className="hover:text-primary">Source</a>
      </footer>
    </div>
  );
}
