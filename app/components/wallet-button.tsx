"use client";

import { useState, useRef, useEffect } from "react";
import { useWallet } from "../lib/wallet/context";
import { useBalance } from "../lib/hooks/use-balance";
import { lamportsToSolString } from "../lib/lamports";
import { ellipsify } from "../lib/explorer";
import { useCluster } from "./cluster-context";
import { OnboardingModal } from "./onboarding-modal";

export function WalletButton() {
  const { disconnect, wallet, status } = useWallet();

  const { getExplorerUrl } = useCluster();
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const address = wallet?.account.address;
  const balance = useBalance(address);

  const open = () => setIsOpen(true);
  const close = () => setIsOpen(false);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCopy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (status !== "connected") {
    return (
      <>
        <button
          onClick={() => setIsOpen(true)}
          className="cursor-pointer rounded-lg bg-emerald-500 hover:bg-emerald-600 px-4 py-2 text-xs font-semibold text-black shadow-xs transition"
        >
          Get Started / Connect
        </button>

        <OnboardingModal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
        />
      </>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => (isOpen ? close() : open())}
        className="flex cursor-pointer items-center gap-2 rounded-lg border border-border-low bg-card px-3 py-2 text-xs font-medium transition hover:bg-cream"
      >
        <span className="h-2 w-2 rounded-full bg-green-500" />
        <span className="font-mono">{ellipsify(address!, 4)}</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-border-low bg-card p-4 shadow-lg">
          <div className="mb-3">
            <p className="text-xs text-muted">Balance</p>
            <p className="text-lg font-bold tabular-nums">
              {balance.lamports != null
                ? lamportsToSolString(balance.lamports)
                : "\u2014"}{" "}
              <span className="text-sm font-normal text-muted">SOL</span>
            </p>
          </div>

          <div className="mb-3 rounded-lg border border-border-low bg-cream/50 px-3 py-2">
            <p className="break-all font-mono text-xs">{address}</p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="flex-1 cursor-pointer rounded-lg border border-border-low bg-card px-3 py-2 text-xs font-medium transition hover:bg-cream"
            >
              {copied ? "Copied!" : "Copy address"}
            </button>
            <a
              href={getExplorerUrl(`/address/${address}`)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 rounded-lg border border-border-low bg-card px-3 py-2 text-center text-xs font-medium transition hover:bg-cream"
            >
              Explorer
            </a>
          </div>

          <button
            onClick={() => {
              disconnect();
              close();
            }}
            className="mt-2 w-full cursor-pointer rounded-lg border border-border-low bg-card px-3 py-2 text-xs font-medium text-destructive transition hover:bg-destructive/10"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
