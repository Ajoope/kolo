"use client";

import { useState } from "react";
import { lamports as sol } from "@solana/kit";
import { toast } from "sonner";
import { useWallet } from "./lib/wallet/context";
import { useBalance } from "./lib/hooks/use-balance";
import { lamportsToSolString } from "./lib/lamports";
import { useSolanaClient } from "./lib/solana-client-context";
import { ellipsify } from "./lib/explorer";
import { DashboardView } from "./components/dashboard-view";
import { CircleView } from "./components/circle-view";
import { CreateCircleModal } from "./components/create-circle-modal";
import { WalletButton } from "./components/wallet-button";
import { ClusterSelect } from "./components/cluster-select";
import { useCluster } from "./components/cluster-context";
import { useCircles } from "./lib/hooks/use-circles";
import type { UnifiedCircleView } from "./lib/kolo/fetcher";

export default function Home() {
  const { wallet } = useWallet();
  const { getExplorerUrl } = useCluster();
  const client = useSolanaClient();
  const { refreshCircles } = useCircles();

  const address = wallet?.account.address;
  const balance = useBalance(address);
  const [copied, setCopied] = useState(false);

  // View state
  const [currentView, setCurrentView] = useState<"dashboard" | "circle_detail">("dashboard");
  const [activeCircleView, setActiveCircleView] = useState<UnifiedCircleView | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const handleCopy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAirdrop = async () => {
    if (!address) return;
    try {
      toast.info("Requesting Devnet SOL airdrop...");
      const sig = await client.airdrop(address, sol(1_000_000_000n));
      toast.success("Devnet SOL received!", {
        description: sig ? (
          <a
            href={getExplorerUrl(`/tx/${sig}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-[var(--kolo-terracotta)]"
          >
            View transaction on Explorer
          </a>
        ) : undefined,
      });
    } catch (err) {
      console.error("Airdrop failed:", err);
      toast.error("Devnet faucet rate-limited. Please use https://faucet.solana.com.");
    }
  };

  return (
    <div className="min-h-screen bg-[var(--kolo-bg)] text-[var(--kolo-ink)] flex flex-col justify-between">
      <div>
        {/* Navigation Bar */}
        <header className="border-b border-[var(--kolo-border)] bg-[var(--kolo-surface)]">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 py-4">
            {/* Brand Logo & Name */}
            <div
              onClick={() => setCurrentView("dashboard")}
              className="flex items-center gap-3 cursor-pointer select-none"
            >
              <div className="w-10 h-10 rounded-2xl bg-[var(--kolo-clay-soft)] border border-[var(--kolo-terracotta)]/30 flex items-center justify-center text-[var(--kolo-terracotta)] font-serif font-bold text-xl shadow-xs">
                K
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-serif font-bold text-lg tracking-tight text-[var(--kolo-ink)]">
                    Kolo
                  </span>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[var(--kolo-surface-subtle)] text-[var(--kolo-ink-muted)] border border-[var(--kolo-border)]">
                    Devnet
                  </span>
                </div>
                <p className="text-[11px] text-[var(--kolo-ink-muted)] -mt-0.5">
                  Communal Ajo Savings
                </p>
              </div>
            </div>

            {/* Navigation & Controls */}
            <div className="flex items-center gap-3">
              {currentView === "circle_detail" && (
                <button
                  onClick={() => setCurrentView("dashboard")}
                  className="px-3 py-1.5 text-xs font-medium text-[var(--kolo-ink-muted)] hover:text-[var(--kolo-ink)] hover:bg-[var(--kolo-surface-subtle)] rounded-lg transition-colors"
                >
                  &larr; Back to dashboard
                </button>
              )}

              <ClusterSelect />
              <WalletButton />
            </div>
          </div>
        </header>

        {/* Connected Wallet Micro-Bar (if connected) */}
        {address && (
          <div className="bg-[var(--kolo-surface-subtle)] border-b border-[var(--kolo-border)] px-4 sm:px-6 py-2">
            <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[var(--kolo-sage)]" />
                <span className="text-[var(--kolo-ink-muted)]">Connected:</span>
                <span className="font-medium text-[var(--kolo-ink)]">
                  {ellipsify(address)}
                </span>
                <button
                  onClick={handleCopy}
                  className="text-[var(--kolo-ink-muted)] hover:text-[var(--kolo-ink)] transition-colors"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-[var(--kolo-ink-muted)]">
                  Balance:{" "}
                  <strong className="text-[var(--kolo-ink)]">
                    {balance.lamports !== null
                      ? `${lamportsToSolString(balance.lamports)} SOL`
                      : balance.isLoading
                        ? "Loading..."
                        : "Unavailable"}
                  </strong>
                </span>
                <button
                  onClick={handleAirdrop}
                  className="text-[var(--kolo-terracotta)] hover:underline font-medium"
                >
                  Request Devnet SOL
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <main className="pb-16">
          {currentView === "dashboard" ? (
            <DashboardView
              onSelectCircle={(circle) => {
                setActiveCircleView(circle);
                setCurrentView("circle_detail");
              }}
              onCreateCircleClick={() => {
                setIsCreateModalOpen(true);
              }}
              onJoinInviteClick={() => {
                setCurrentView("circle_detail");
              }}
            />
          ) : (
            <CircleView />
          )}
        </main>

        {/* Create Circle Modal */}
        <CreateCircleModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onCircleCreated={() => {
            refreshCircles();
          }}
        />
      </div>

      {/* Warm Footer */}
      <footer className="border-t border-[var(--kolo-border)] bg-[var(--kolo-surface)] py-6 text-center text-xs text-[var(--kolo-ink-muted)]">
        <div className="max-w-6xl mx-auto px-4 space-y-1">
          <p>
            Kolo * Decentralized Rotating Savings & Collateral Protection Protocol
          </p>
          <p className="text-[11px] text-[var(--kolo-ink-muted)]/80">
            Powered by Solana Devnet Anchor Program{" "}
            <code className="font-mono text-[10px]">BVNGa6bQ...y5c</code>
          </p>
        </div>
      </footer>
    </div>
  );
}
