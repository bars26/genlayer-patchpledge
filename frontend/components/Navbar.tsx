"use client";

import { AccountPanel } from "./AccountPanel";
import { BrandMark } from "./BrandMark";
import { CreatePledgeModal } from "./CreatePledgeModal";
import { FaucetButton } from "./FaucetButton";

export function Navbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-[#F6F4EE]/85 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
        <a href="/" className="flex items-center gap-2.5">
          <BrandMark size={28} />
          <span className="text-lg font-bold tracking-tight">PatchPledge</span>
          <span className="hidden md:inline mono text-[11px] text-muted-foreground border border-border rounded px-1.5 py-0.5">GenLayer Studio</span>
        </a>
        <div className="flex items-center gap-2 sm:gap-3">
          <FaucetButton />
          <CreatePledgeModal />
          <AccountPanel />
        </div>
      </div>
    </header>
  );
}
