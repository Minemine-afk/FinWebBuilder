"use client";

import { useState } from "react";
import { BuildProgress } from "./build-progress";
import { BuilderPanel, ClaudeLinkCheck, PasscodeField, RemovePanel, SetupPanel } from "./builder-forms";
import { Sidebar, type SidebarCalculator, type View } from "./sidebar";

/** Page chrome: a left sidebar (a drawer on phones) beside the main area, which swaps between the home page and the Claude panels. */
export function HomeShell({ calculators, header, cards }: { calculators: SidebarCalculator[]; header: React.ReactNode; cards: React.ReactNode }) {
  const [view, setView] = useState<View>("home");
  const [passcode, setPasscode] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  function go(v: View) {
    setView(v);
    setMenuOpen(false);
  }

  return (
    <div className="min-h-screen md:flex">
      <div className="flex items-center justify-between border-b border-border bg-sidebar px-4 py-3 md:hidden">
        <span className="font-semibold">Finexis calculators</span>
        <button type="button" className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm" aria-expanded={menuOpen} aria-controls="sidebar" onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? "Close" : "Menu"}
        </button>
      </div>
      <aside id="sidebar" className={`${menuOpen ? "block" : "hidden"} border-border bg-sidebar md:sticky md:top-0 md:block md:h-screen md:w-72 md:shrink-0 md:overflow-y-auto md:border-r`}>
        <Sidebar calculators={calculators} view={view} onView={go} />
      </aside>

      <main className="min-w-0 flex-1 px-4 py-10 md:px-10">
        <div className="mx-auto max-w-5xl">
          {view === "home" ? (
            <>
              {header}
              <BuilderPanel calculators={calculators} passcode={passcode} setPasscode={setPasscode} />
              <BuildProgress />
              {cards}
              <RemovePanel calculators={calculators} passcode={passcode} />
            </>
          ) : (
            <>
              <h1 className="text-3xl font-semibold">Claude options</h1>
              <p className="mt-2 max-w-2xl text-muted">Connect the builder to Claude and check that the link works.</p>
              <PasscodeField passcode={passcode} setPasscode={setPasscode} />
              <div className="mt-6 grid max-w-3xl gap-6">
                {view === "setup" ? <SetupPanel passcode={passcode} /> : <ClaudeLinkCheck passcode={passcode} />}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
