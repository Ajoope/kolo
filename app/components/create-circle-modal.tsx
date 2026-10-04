"use client";

import { useState, useCallback } from "react";
import { useWallet } from "../lib/wallet/context";
import { useSendTransaction } from "../lib/hooks/use-send-transaction";
import { useCluster } from "./cluster-context";
import { parseTransactionError } from "../lib/errors";
import { toast } from "sonner";
import {
  DEVNET_USDC_MINT,
  getCirclePda,
  getVaultPda,
  getCreateCircleInstruction,
} from "../lib/kolo/program";
import { ellipsify } from "../lib/explorer";

interface CreateCircleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCircleCreated?: (circleAddress: string) => void;
}

export function CreateCircleModal({
  isOpen,
  onClose,
  onCircleCreated,
}: CreateCircleModalProps) {
  const { wallet, signer, status: walletStatus } = useWallet();
  const { send, isSending } = useSendTransaction();
  const { getExplorerUrl } = useCluster();

  // Form inputs
  const [name, setName] = useState("Friends & Family Savings");
  const [contributionAmount, setContributionAmount] = useState<number>(50); // USDC
  const [frequencyDays, setFrequencyDays] = useState<number>(7); // Days
  const [maxMembers, setMaxMembers] = useState<number>(3); // 2-16

  // Post-creation state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdCircleAddress, setCreatedCircleAddress] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [shareableInviteLink, setShareableInviteLink] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const walletAddress = wallet?.account.address;

  // Handle Circle Creation
  const handleCreate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!walletAddress || !signer) {
        toast.error("Please connect your wallet first to start a circle.");
        return;
      }

      if (contributionAmount <= 0) {
        toast.error("Contribution amount must be greater than 0 USDC.");
        return;
      }

      if (maxMembers < 2 || maxMembers > 16) {
        toast.error("Member count must be between 2 and 16.");
        return;
      }

      setIsSubmitting(true);
      setCreatedCircleAddress(null);
      setTxSignature(null);

      try {
        // Unique circle ID using timestamp to avoid collisions
        const circleId = BigInt(Math.floor(Date.now() / 1000));
        const [circlePda] = await getCirclePda(walletAddress, circleId);
        const [vaultPda] = await getVaultPda(circlePda);

        // Convert contribution amount to 6-decimal integer (USDC standard)
        const amountInBaseUnits = BigInt(Math.round(contributionAmount * 1_000_000));
        const frequencySeconds = BigInt(frequencyDays * 86400);

        const instruction = getCreateCircleInstruction({
          creator: signer,
          circle: circlePda,
          vault: vaultPda,
          usdcMint: DEVNET_USDC_MINT,
          circleId,
          contributionAmount: amountInBaseUnits,
          frequency: frequencySeconds,
          maxMembers,
          payoutOrder: [walletAddress],
        });

        const signature = await send({ instructions: [instruction] });
        setTxSignature(signature);
        setCreatedCircleAddress(circlePda);

        // Generate shareable invite link
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const inviteUrl = `${origin}?circle=${circlePda}&creator=${walletAddress}&id=${circleId.toString()}`;
        setShareableInviteLink(inviteUrl);

        toast.success("Savings circle initialized on Solana Devnet!");

        if (onCircleCreated) {
          onCircleCreated(circlePda);
        }
      } catch (err) {
        console.error("Circle creation error:", err);
        const friendlyError = parseTransactionError(err);
        toast.error(friendlyError);
      } finally {
        setIsSubmitting(false);
      }
    },
    [walletAddress, signer, contributionAmount, frequencyDays, maxMembers, send, onCircleCreated]
  );

  const handleCopyLink = async () => {
    if (!shareableInviteLink) return;
    await navigator.clipboard.writeText(shareableInviteLink);
    setCopiedLink(true);
    toast.success("Invite link copied to clipboard!");
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const handleResetAndClose = () => {
    setCreatedCircleAddress(null);
    setTxSignature(null);
    setShareableInviteLink(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-[var(--kolo-border)] bg-[var(--kolo-card)] p-6 sm:p-8 shadow-xl text-[var(--kolo-ink)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={handleResetAndClose}
          className="absolute right-4 top-4 p-2 text-[var(--kolo-ink-muted)] hover:text-[var(--kolo-ink)] rounded-full hover:bg-[var(--kolo-surface-subtle)] transition"
          aria-label="Close modal"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Brand Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-2xl bg-[var(--kolo-clay-soft)] border border-[var(--kolo-terracotta)]/30 flex items-center justify-center text-[var(--kolo-terracotta)] font-serif font-bold text-lg shadow-xs">
            K
          </div>
          <div>
            <h2 className="font-serif text-xl font-bold tracking-tight text-[var(--kolo-ink)]">
              Start a new savings circle
            </h2>
            <p className="text-xs text-[var(--kolo-ink-muted)] mt-0.5">
              Set contribution terms and invite your trusted community
            </p>
          </div>
        </div>

        {!createdCircleAddress ? (
          /* Form View */
          <form onSubmit={handleCreate} className="space-y-5">
            {/* Circle Name */}
            <div>
              <label className="block text-xs font-medium text-[var(--kolo-ink-muted)] mb-1.5">
                Circle name or purpose
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lagos Builders Savings, Family Holiday Pot"
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[var(--kolo-border)] bg-[var(--kolo-canvas)] text-[var(--kolo-ink)] placeholder:[var(--kolo-ink-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--kolo-terracotta)]"
              />
            </div>

            {/* Contribution Amount */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-[var(--kolo-ink-muted)]">
                  Contribution per round (USDC)
                </label>
                <span className="text-[11px] text-[var(--kolo-ink-muted)]">
                  Fixed deposit per round
                </span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={contributionAmount}
                  onChange={(e) => setContributionAmount(Math.max(1, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[var(--kolo-border)] bg-[var(--kolo-canvas)] text-[var(--kolo-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--kolo-terracotta)]"
                />
                <span className="absolute right-3.5 top-2.5 text-xs font-medium text-[var(--kolo-ink-muted)]">
                  USDC
                </span>
              </div>
            </div>

            {/* Frequency & Members in 2 Columns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--kolo-ink-muted)] mb-1.5">
                  Round frequency
                </label>
                <select
                  value={frequencyDays}
                  onChange={(e) => setFrequencyDays(Number(e.target.value))}
                  className="w-full px-3 py-2.5 text-sm rounded-xl border border-[var(--kolo-border)] bg-[var(--kolo-canvas)] text-[var(--kolo-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--kolo-terracotta)]"
                >
                  <option value={1}>Every day (1 day)</option>
                  <option value={7}>Weekly (7 days)</option>
                  <option value={14}>Bi-weekly (14 days)</option>
                  <option value={30}>Monthly (30 days)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--kolo-ink-muted)] mb-1.5">
                  Total member seats
                </label>
                <select
                  value={maxMembers}
                  onChange={(e) => setMaxMembers(Number(e.target.value))}
                  className="w-full px-3 py-2.5 text-sm rounded-xl border border-[var(--kolo-border)] bg-[var(--kolo-canvas)] text-[var(--kolo-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--kolo-terracotta)]"
                >
                  {[2, 3, 4, 5, 6, 8, 10, 12, 16].map((num) => (
                    <option key={num} value={num}>
                      {num} members ({num} rounds)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Summary Box */}
            <div className="p-4 rounded-2xl bg-[var(--kolo-surface-subtle)] border border-[var(--kolo-border)] space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--kolo-ink-muted)]">Total pot each round:</span>
                <span className="font-semibold text-[var(--kolo-ink)]">
                  ${(contributionAmount * maxMembers).toLocaleString()} USDC
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--kolo-ink-muted)]">Required collateral stake:</span>
                <span className="font-semibold text-[var(--kolo-ink)]">
                  ${contributionAmount.toLocaleString()} USDC (100% refunded at finish)
                </span>
              </div>
            </div>

            {/* Submit CTA */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting || isSending || walletStatus !== "connected"}
                className="w-full py-3 text-sm font-medium text-white bg-[var(--kolo-terracotta)] hover:bg-[var(--kolo-terracotta-hover)] disabled:opacity-50 disabled:cursor-not-allowed rounded-full shadow-sm transition-all flex items-center justify-center gap-2"
              >
                {isSubmitting || isSending ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Initializing circle on Devnet...
                  </>
                ) : (
                  "Create circle & lock terms"
                )}
              </button>
            </div>
          </form>
        ) : (
          /* Confirmation & Share Link View */
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 mx-auto rounded-full bg-[var(--kolo-sage-soft)] text-[var(--kolo-sage)] flex items-center justify-center text-xl font-bold">
                ✓
              </div>
              <h3 className="font-serif text-xl text-[var(--kolo-ink)]">
                Savings circle created!
              </h3>
              <p className="text-xs text-[var(--kolo-ink-muted)]">
                Your circle account is confirmed on Solana Devnet. Share this invite link with your members so they can lock their stake and join.
              </p>
            </div>

            {/* On-Chain Account Details */}
            <div className="p-4 rounded-2xl bg-[var(--kolo-surface-subtle)] border border-[var(--kolo-border)] space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--kolo-ink-muted)]">Circle account:</span>
                <span className="font-mono text-[var(--kolo-ink)]">
                  {ellipsify(createdCircleAddress)}
                </span>
              </div>
              {txSignature && (
                <div className="flex justify-between items-center">
                  <span className="text-[var(--kolo-ink-muted)]">Receipt:</span>
                  <a
                    href={getExplorerUrl(`/tx/${txSignature}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--kolo-terracotta)] hover:underline font-medium text-[11px]"
                  >
                    View transaction on Explorer
                  </a>
                </div>
              )}
            </div>

            {/* Shareable Invite Link */}
            {shareableInviteLink && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-[var(--kolo-ink)]">
                  Shareable invite link
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareableInviteLink}
                    className="flex-1 px-3 py-2 text-xs rounded-xl border border-[var(--kolo-border)] bg-[var(--kolo-canvas)] text-[var(--kolo-ink)] font-mono select-all focus:outline-none"
                  />
                  <button
                    onClick={handleCopyLink}
                    className="px-4 py-2 text-xs font-medium text-white bg-[var(--kolo-terracotta)] hover:bg-[var(--kolo-terracotta-hover)] rounded-xl transition-colors shrink-0"
                  >
                    {copiedLink ? "Copied" : "Copy link"}
                  </button>
                </div>
              </div>
            )}

            {/* Return CTA */}
            <button
              onClick={handleResetAndClose}
              className="w-full py-3 text-xs font-medium text-[var(--kolo-ink)] bg-[var(--kolo-surface-subtle)] hover:bg-[var(--kolo-border)] rounded-full transition-colors"
            >
              Done & view on dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
