"use client";

import { useState, useCallback } from "react";
import { useWallet } from "../lib/wallet/context";
import { useSendTransaction } from "../lib/hooks/use-send-transaction";
import { useCluster } from "./cluster-context";
import { parseTransactionError } from "../lib/errors";
import { toast } from "sonner";
import { type Address, address } from "@solana/kit";
import {
  KOLO_PROGRAM_ID,
  DEVNET_USDC_MINT,
  getCirclePda,
  getVaultPda,
  getMemberPda,
  getAssociatedTokenAddress,
  getCreateAssociatedTokenIdempotentInstruction,
  getCreateCircleInstruction,
  getJoinCircleInstruction,
  getContributeInstruction,
  getReleasePayoutInstruction,
  getCompleteCircleInstruction,
} from "../lib/kolo/program";
import { ellipsify } from "../lib/explorer";

interface CircleState {
  id: number;
  creator: Address;
  name: string;
  contributionAmount: number; // in USDC
  frequencyDays: number;
  maxMembers: number;
  memberCount: number;
  currentRound: number;
  status: "Forming" | "Active" | "Completed" | "Cancelled";
  vaultBalance: number;
  userStaked: boolean;
  userContributedThisRound: boolean;
}

export function CircleView() {
  const { wallet, signer, status: walletStatus } = useWallet();
  const { send, isSending } = useSendTransaction();
  const { getExplorerUrl } = useCluster();

  // Circle state
  const [circleId, setCircleId] = useState<number>(101);
  const [activeCircle, setActiveCircle] = useState<CircleState>({
    id: 101,
    creator: address("11111111111111111111111111111111"),
    name: "Lagos Builders Kolo Circle #1",
    contributionAmount: 50,
    frequencyDays: 7,
    maxMembers: 3,
    memberCount: 1,
    currentRound: 0,
    status: "Forming",
    vaultBalance: 50,
    userStaked: false,
    userContributedThisRound: false,
  });

  // Action status state
  const [actionType, setActionType] = useState<string | null>(null);
  const [lastTxSignature, setLastTxSignature] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<
    Array<{ type: string; signature: string; timestamp: string }>
  >([]);

  const walletAddress = wallet?.account.address;

  // ---------------------------------------------------------------------------
  // ACTION: Create Circle (if forming new circle on Devnet)
  // ---------------------------------------------------------------------------
  const handleCreateCircle = useCallback(async () => {
    if (!walletAddress || !signer) {
      toast.error("Please connect your wallet first.");
      return;
    }

    setActionType("create_circle");
    setActionError(null);
    setLastTxSignature(null);

    try {
      const [circlePda] = await getCirclePda(walletAddress, circleId);
      const [vaultPda] = await getVaultPda(circlePda);

      const instruction = getCreateCircleInstruction({
        creator: signer,
        circle: circlePda,
        vault: vaultPda,
        usdcMint: DEVNET_USDC_MINT,
        circleId: BigInt(circleId),
        contributionAmount: BigInt(activeCircle.contributionAmount * 1_000_000), // 6 decimals
        frequency: BigInt(activeCircle.frequencyDays * 86400),
        maxMembers: activeCircle.maxMembers,
        payoutOrder: [walletAddress],
      });

      const signature = await send({ instructions: [instruction] });
      setLastTxSignature(signature);

      setRecentTransactions((prev) => [
        {
          type: "create_circle",
          signature,
          timestamp: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);

      toast.success("Circle created on Solana Devnet!", {
        description: (
          <a
            href={getExplorerUrl(`/tx/${signature}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-emerald-400 font-mono text-xs"
          >
            View on Solana Explorer &rarr;
          </a>
        ),
      });
    } catch (err: unknown) {
      console.error("Create circle error:", err);
      const friendlyError = parseTransactionError(err);
      setActionError(friendlyError);
      toast.error(friendlyError);
    } finally {
      setActionType(null);
    }
  }, [walletAddress, signer, circleId, activeCircle, send, getExplorerUrl]);

  // ---------------------------------------------------------------------------
  // ACTION: Join Circle (locks 1x collateral stake)
  // ---------------------------------------------------------------------------
  const handleJoinCircle = useCallback(async () => {
    if (!walletAddress || !signer) {
      toast.error("Please connect your wallet first.");
      return;
    }

    setActionType("join_circle");
    setActionError(null);
    setLastTxSignature(null);

    try {
      // 1. Derive PDAs
      const creatorAddress = activeCircle.creator || walletAddress;
      const [circlePda] = await getCirclePda(creatorAddress, circleId);
      const [vaultPda] = await getVaultPda(circlePda);
      const [memberPda] = await getMemberPda(circlePda, walletAddress);
      const [memberAta] = await getAssociatedTokenAddress(walletAddress, DEVNET_USDC_MINT);

      // 2. Unconditionally prepend createAssociatedTokenIdempotentInstruction (no-op if already exists)
      const createAtaIx = getCreateAssociatedTokenIdempotentInstruction({
        payer: signer,
        owner: walletAddress,
        mint: DEVNET_USDC_MINT,
        ata: memberAta,
      });

      const joinIx = getJoinCircleInstruction({
        memberWallet: signer,
        circle: circlePda,
        member: memberPda,
        vault: vaultPda,
        memberTokenAccount: memberAta,
      });

      // Execute atomic transaction
      const signature = await send({ instructions: [createAtaIx, joinIx] });
      setLastTxSignature(signature);

      setActiveCircle((prev) => ({
        ...prev,
        memberCount: Math.min(prev.maxMembers, prev.memberCount + 1),
        userStaked: true,
        vaultBalance: prev.vaultBalance + prev.contributionAmount,
        status: prev.memberCount + 1 >= prev.maxMembers ? "Active" : "Forming",
      }));

      setRecentTransactions((prev) => [
        {
          type: "join_circle",
          signature,
          timestamp: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);

      toast.success("Joined circle & locked 1x collateral stake!", {
        description: (
          <a
            href={getExplorerUrl(`/tx/${signature}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-emerald-400 font-mono text-xs"
          >
            View on Solana Explorer &rarr;
          </a>
        ),
      });
    } catch (err: unknown) {
      console.error("Join circle error:", err);
      const friendlyError = parseTransactionError(err);
      setActionError(friendlyError);
      toast.error(friendlyError);
    } finally {
      setActionType(null);
    }
  }, [walletAddress, signer, activeCircle, circleId, send, getExplorerUrl]);

  // ---------------------------------------------------------------------------
  // ACTION: Contribute (pays round contribution into vault)
  // ---------------------------------------------------------------------------
  const handleContribute = useCallback(async () => {
    if (!walletAddress || !signer) {
      toast.error("Please connect your wallet first.");
      return;
    }

    setActionType("contribute");
    setActionError(null);
    setLastTxSignature(null);

    try {
      const creatorAddress = activeCircle.creator || walletAddress;
      const [circlePda] = await getCirclePda(creatorAddress, circleId);
      const [vaultPda] = await getVaultPda(circlePda);
      const [memberPda] = await getMemberPda(circlePda, walletAddress);
      const [memberAta] = await getAssociatedTokenAddress(walletAddress, DEVNET_USDC_MINT);

      // Unconditionally prepend createAssociatedTokenIdempotentInstruction (no-op if already exists)
      const createAtaIx = getCreateAssociatedTokenIdempotentInstruction({
        payer: signer,
        owner: walletAddress,
        mint: DEVNET_USDC_MINT,
        ata: memberAta,
      });

      const contributeIx = getContributeInstruction({
        memberWallet: signer,
        circle: circlePda,
        member: memberPda,
        vault: vaultPda,
        memberTokenAccount: memberAta,
      });

      // Execute atomic transaction
      const signature = await send({ instructions: [createAtaIx, contributeIx] });
      setLastTxSignature(signature);

      setActiveCircle((prev) => ({
        ...prev,
        vaultBalance: prev.vaultBalance + prev.contributionAmount,
        userContributedThisRound: true,
      }));

      setRecentTransactions((prev) => [
        {
          type: "contribute",
          signature,
          timestamp: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);

      toast.success(`Contributed ${activeCircle.contributionAmount} USDC to Round ${activeCircle.currentRound + 1}!`, {
        description: (
          <a
            href={getExplorerUrl(`/tx/${signature}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-emerald-400 font-mono text-xs"
          >
            View on Solana Explorer &rarr;
          </a>
        ),
      });
    } catch (err: unknown) {
      console.error("Contribute error:", err);
      const friendlyError = parseTransactionError(err);
      setActionError(friendlyError);
      toast.error(friendlyError);
    } finally {
      setActionType(null);
    }
  }, [walletAddress, signer, activeCircle, circleId, send, getExplorerUrl]);

  // ---------------------------------------------------------------------------
  // ACTION: Release Payout
  // ---------------------------------------------------------------------------
  const handleReleasePayout = useCallback(async () => {
    if (!walletAddress || !signer) {
      toast.error("Please connect your wallet first.");
      return;
    }

    setActionType("release_payout");
    setActionError(null);
    setLastTxSignature(null);

    try {
      const creatorAddress = activeCircle.creator || walletAddress;
      const [circlePda] = await getCirclePda(creatorAddress, circleId);
      const [vaultPda] = await getVaultPda(circlePda);
      const [recipientMemberPda] = await getMemberPda(circlePda, walletAddress);
      const [recipientAta] = await getAssociatedTokenAddress(walletAddress, DEVNET_USDC_MINT);

      const instruction = getReleasePayoutInstruction({
        caller: signer,
        circle: circlePda,
        recipientMember: recipientMemberPda,
        vault: vaultPda,
        recipientTokenAccount: recipientAta,
      });

      const signature = await send({ instructions: [instruction] });
      setLastTxSignature(signature);

      setActiveCircle((prev) => ({
        ...prev,
        currentRound: prev.currentRound + 1,
        userContributedThisRound: false,
        status: prev.currentRound + 1 >= prev.maxMembers ? "Completed" : "Active",
      }));

      setRecentTransactions((prev) => [
        {
          type: "release_payout",
          signature,
          timestamp: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);

      toast.success("Round payout pot released to recipient!", {
        description: (
          <a
            href={getExplorerUrl(`/tx/${signature}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-emerald-400 font-mono text-xs"
          >
            View on Solana Explorer &rarr;
          </a>
        ),
      });
    } catch (err: unknown) {
      console.error("Release payout error:", err);
      const friendlyError = parseTransactionError(err);
      setActionError(friendlyError);
      toast.error(friendlyError);
    } finally {
      setActionType(null);
    }
  }, [walletAddress, signer, activeCircle, circleId, send, getExplorerUrl]);

  // ---------------------------------------------------------------------------
  // ACTION: Complete Circle & Refund Stake
  // ---------------------------------------------------------------------------
  const handleCompleteRefundStake = useCallback(async () => {
    if (!walletAddress || !signer) {
      toast.error("Please connect your wallet first.");
      return;
    }

    setActionType("complete_circle");
    setActionError(null);
    setLastTxSignature(null);

    try {
      const creatorAddress = activeCircle.creator || walletAddress;
      const [circlePda] = await getCirclePda(creatorAddress, circleId);
      const [vaultPda] = await getVaultPda(circlePda);
      const [memberPda] = await getMemberPda(circlePda, walletAddress);
      const [memberAta] = await getAssociatedTokenAddress(walletAddress, DEVNET_USDC_MINT);

      const instruction = getCompleteCircleInstruction({
        memberWallet: signer,
        circle: circlePda,
        member: memberPda,
        vault: vaultPda,
        memberTokenAccount: memberAta,
      });

      const signature = await send({ instructions: [instruction] });
      setLastTxSignature(signature);

      setActiveCircle((prev) => ({
        ...prev,
        userStaked: false,
      }));

      setRecentTransactions((prev) => [
        {
          type: "complete_circle",
          signature,
          timestamp: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);

      toast.success("100% Collateral stake refunded to your wallet!", {
        description: (
          <a
            href={getExplorerUrl(`/tx/${signature}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-emerald-400 font-mono text-xs"
          >
            View on Solana Explorer &rarr;
          </a>
        ),
      });
    } catch (err: unknown) {
      console.error("Refund stake error:", err);
      const friendlyError = parseTransactionError(err);
      setActionError(friendlyError);
      toast.error(friendlyError);
    } finally {
      setActionType(null);
    }
  }, [walletAddress, signer, activeCircle, circleId, send, getExplorerUrl]);

  const isExecuting = isSending || actionType !== null;

  return (
    <div className="w-full space-y-6">
      {/* Circle Header & Live Stats */}
      <div className="rounded-3xl border border-[var(--kolo-border)] bg-[var(--kolo-surface)] p-6 md:p-8 shadow-xs relative overflow-hidden">
        {/* Warm clay accent wash */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-[var(--kolo-clay-soft)]/60 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-[var(--kolo-surface-subtle)] text-[var(--kolo-ink-muted)] border border-[var(--kolo-border)]">
                  Circle #{circleId}
                </span>
                <span
                  className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${
                    activeCircle.status === "Forming"
                      ? "bg-[var(--kolo-ochre-soft)] text-[var(--kolo-ochre)] border-[var(--kolo-ochre)]/30"
                      : activeCircle.status === "Active"
                      ? "bg-[var(--kolo-sage-soft)] text-[var(--kolo-sage)] border-[var(--kolo-sage)]/30"
                      : "bg-[var(--kolo-surface-subtle)] text-[var(--kolo-ink-muted)] border-[var(--kolo-border)]"
                  }`}
                >
                  {activeCircle.status}
                </span>
              </div>
              <h2 className="text-2xl md:text-3xl font-serif font-bold tracking-tight text-[var(--kolo-ink)]">
                {activeCircle.name}
              </h2>
              <p className="text-xs text-[var(--kolo-ink-muted)] mt-1">
                On-chain program:{" "}
                <a
                  href={getExplorerUrl(`/address/${KOLO_PROGRAM_ID}`)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--kolo-terracotta)] hover:underline"
                >
                  {ellipsify(KOLO_PROGRAM_ID, 6)}
                </a>
              </p>
            </div>

            {/* Quick Circle Switcher */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--kolo-ink-muted)]">Circle ID:</span>
              <input
                type="number"
                value={circleId}
                onChange={(e) => setCircleId(Number(e.target.value))}
                className="w-20 rounded-lg border border-[var(--kolo-border)] bg-[var(--kolo-canvas)] px-3 py-1.5 text-xs text-[var(--kolo-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--kolo-terracotta)]"
              />
            </div>
          </div>

          {/* Metric Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="p-4 rounded-2xl bg-[var(--kolo-surface-subtle)] border border-[var(--kolo-border)] space-y-1">
              <span className="text-[11px] text-[var(--kolo-ink-muted)]">
                Round contribution
              </span>
              <p className="text-2xl font-serif font-bold text-[var(--kolo-ink)] tabular-nums">
                {activeCircle.contributionAmount}{" "}
                <span className="text-xs text-[var(--kolo-ink-muted)]">USDC</span>
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-[var(--kolo-surface-subtle)] border border-[var(--kolo-border)] space-y-1">
              <span className="text-[11px] text-[var(--kolo-ink-muted)]">
                Circle members
              </span>
              <p className="text-2xl font-serif font-bold text-[var(--kolo-ink)] tabular-nums">
                {activeCircle.memberCount}{" "}
                <span className="text-xs text-[var(--kolo-ink-muted)]">
                  / {activeCircle.maxMembers}
                </span>
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-[var(--kolo-surface-subtle)] border border-[var(--kolo-border)] space-y-1">
              <span className="text-[11px] text-[var(--kolo-ink-muted)]">
                Current round
              </span>
              <p className="text-2xl font-serif font-bold text-[var(--kolo-ink)] tabular-nums">
                Round {activeCircle.currentRound + 1}{" "}
                <span className="text-xs text-[var(--kolo-ink-muted)]">
                  / {activeCircle.maxMembers}
                </span>
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-[var(--kolo-surface-subtle)] border border-[var(--kolo-border)] space-y-1">
              <span className="text-[11px] text-[var(--kolo-ink-muted)]">
                Vault balance
              </span>
              <p className="text-2xl font-serif font-bold text-[var(--kolo-sage)] tabular-nums">
                {activeCircle.vaultBalance}{" "}
                <span className="text-xs text-[var(--kolo-sage)]">USDC</span>
              </p>
            </div>
          </div>

          {/* Error Banner if any instruction fails */}
          {actionError && (
            <div className="p-4 rounded-2xl bg-[var(--kolo-rust-soft)] border border-[var(--kolo-rust)]/30 text-[var(--kolo-rust)] text-xs flex items-start gap-3 animate-in fade-in duration-200">
              <svg className="w-5 h-5 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="space-y-1">
                <span className="font-medium block">Transaction error</span>
                <p className="leading-relaxed">{actionError}</p>
              </div>
            </div>
          )}

          {/* Success Explorer Banner */}
          {lastTxSignature && (
            <div className="p-4 rounded-2xl bg-[var(--kolo-sage-soft)] border border-[var(--kolo-sage)]/40 text-[var(--kolo-sage)] text-xs flex items-center justify-between gap-3 animate-in fade-in duration-200">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[var(--kolo-sage)] animate-ping" />
                <span className="font-medium">Transaction confirmed on Devnet</span>
              </div>
              <a
                href={getExplorerUrl(`/tx/${lastTxSignature}`)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--kolo-sage)] underline hover:opacity-80 flex items-center gap-1"
              >
                {ellipsify(lastTxSignature, 8)}
              </a>
            </div>
          )}

          {/* Action Buttons Panel */}
          <div className="border-t border-[var(--kolo-border)] pt-6 space-y-4">
            <h3 className="text-sm font-serif font-bold text-[var(--kolo-ink)]">
              Circle actions
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* 1. INITIALIZE CIRCLE */}
              <button
                id="btn-init-circle"
                onClick={handleCreateCircle}
                disabled={isExecuting || walletStatus !== "connected"}
                className="p-4 rounded-2xl border border-[var(--kolo-border)] bg-[var(--kolo-surface)] hover:bg-[var(--kolo-surface-subtle)] disabled:opacity-50 disabled:cursor-not-allowed transition text-left space-y-1.5 group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--kolo-ink)] group-hover:text-[var(--kolo-terracotta)]">
                    Create circle
                  </span>
                  {actionType === "create_circle" && (
                    <span className="w-3.5 h-3.5 border-2 border-[var(--kolo-terracotta)] border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
                <p className="text-[11px] text-[var(--kolo-ink-muted)]">
                  Initializes circle account & vault on Devnet
                </p>
              </button>

              {/* 2. JOIN CIRCLE (LOCK STAKE) */}
              <button
                id="btn-join-circle"
                onClick={handleJoinCircle}
                disabled={isExecuting || walletStatus !== "connected"}
                className="p-4 rounded-2xl border border-[var(--kolo-terracotta)]/40 bg-[var(--kolo-clay-soft)] hover:bg-[var(--kolo-clay)]/60 disabled:opacity-50 disabled:cursor-not-allowed transition text-left space-y-1.5 group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--kolo-terracotta)] group-hover:text-[var(--kolo-terracotta-hover)]">
                    Join circle & lock stake
                  </span>
                  {actionType === "join_circle" ? (
                    <span className="w-3.5 h-3.5 border-2 border-[var(--kolo-terracotta)] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span className="text-[10px] bg-[var(--kolo-terracotta)]/15 text-[var(--kolo-terracotta)] px-2 py-0.5 rounded-full">
                      Lock {activeCircle.contributionAmount} USDC
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[var(--kolo-ink-muted)]">
                  Locks 1x collateral stake into vault
                </p>
              </button>

              {/* 3. CONTRIBUTE ROUND */}
              <button
                id="btn-contribute-round"
                onClick={handleContribute}
                disabled={isExecuting || walletStatus !== "connected"}
                className="p-4 rounded-2xl border border-[var(--kolo-sage)]/40 bg-[var(--kolo-sage-soft)] hover:bg-[var(--kolo-sage)]/15 disabled:opacity-50 disabled:cursor-not-allowed transition text-left space-y-1.5 group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--kolo-sage)] group-hover:text-[var(--kolo-forest)]">
                    Pay contribution
                  </span>
                  {actionType === "contribute" ? (
                    <span className="w-3.5 h-3.5 border-2 border-[var(--kolo-sage)] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span className="text-[10px] bg-[var(--kolo-sage)]/15 text-[var(--kolo-sage)] px-2 py-0.5 rounded-full">
                      Pay {activeCircle.contributionAmount} USDC
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[var(--kolo-ink-muted)]">
                  Pays round contribution into vault
                </p>
              </button>

              {/* 4. RELEASE PAYOUT */}
              <button
                id="btn-release-payout"
                onClick={handleReleasePayout}
                disabled={isExecuting || walletStatus !== "connected"}
                className="p-4 rounded-2xl border border-[var(--kolo-ochre)]/40 bg-[var(--kolo-ochre-soft)] hover:bg-[var(--kolo-ochre)]/15 disabled:opacity-50 disabled:cursor-not-allowed transition text-left space-y-1.5 group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--kolo-ochre)] group-hover:text-[var(--kolo-ochre)]/80">
                    Release payout
                  </span>
                  {actionType === "release_payout" && (
                    <span className="w-3.5 h-3.5 border-2 border-[var(--kolo-ochre)] border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
                <p className="text-[11px] text-[var(--kolo-ink-muted)]">
                  Sends round pot to current recipient
                </p>
              </button>
            </div>

            {/* Complete & Stake Refund Button if Completed */}
            {activeCircle.status === "Completed" && (
              <button
                id="btn-refund-stake"
                onClick={handleCompleteRefundStake}
                disabled={isExecuting || walletStatus !== "connected"}
                className="w-full p-4 rounded-2xl border border-[var(--kolo-sage)] bg-[var(--kolo-sage)] hover:bg-[var(--kolo-forest)] text-white font-medium text-sm transition shadow-sm flex items-center justify-center gap-2"
              >
                {actionType === "complete_circle" ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Refunding stake...
                  </>
                ) : (
                  "Claim 100% collateral stake refund"
                )}
              </button>
            )}
          </div>

          {/* Recent On-Chain Transactions Table */}
          {recentTransactions.length > 0 && (
            <div className="border-t border-[var(--kolo-border)] pt-4 space-y-2">
              <span className="text-[11px] font-medium text-[var(--kolo-ink-muted)]">
                Recent on-chain transactions
              </span>
              <div className="space-y-1.5">
                {recentTransactions.map((tx, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-[var(--kolo-surface-subtle)] border border-[var(--kolo-border)] text-xs"
                  >
                    <span className="text-[var(--kolo-sage)] capitalize">
                      {tx.type.replace("_", " ")}
                    </span>
                    <a
                      href={getExplorerUrl(`/tx/${tx.signature}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--kolo-ink-muted)] underline hover:text-[var(--kolo-ink)]"
                    >
                      {ellipsify(tx.signature, 8)}
                    </a>
                    <span className="text-[10px] text-[var(--kolo-ink-muted)]">{tx.timestamp}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
