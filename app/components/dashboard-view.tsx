"use client";

import { useState } from "react";
import { useWallet } from "../lib/wallet/context";
import { useCircles } from "../lib/hooks/use-circles";
import { useCluster } from "./cluster-context";
import { ellipsify } from "../lib/explorer";
import type { UnifiedCircleView } from "../lib/kolo/fetcher";

interface DashboardViewProps {
  onSelectCircle?: (circle: UnifiedCircleView) => void;
  onCreateCircleClick?: () => void;
  onJoinInviteClick?: () => void;
}

export function DashboardView({
  onSelectCircle,
  onCreateCircleClick,
  onJoinInviteClick,
}: DashboardViewProps) {
  const { wallet } = useWallet();
  const { circles, isLoading, refreshCircles } = useCircles();
  const { getExplorerUrl } = useCluster();

  const walletAddress = wallet?.account.address;

  // Active highlighted circle (defaults to first active circle or first circle)
  const [selectedCircleIndex, setSelectedCircleIndex] = useState<number>(0);

  const activeCircle =
    circles.length > 0
      ? circles[Math.min(selectedCircleIndex, circles.length - 1)]
      : null;

  // Format seconds to human readable countdown
  const formatCountdown = (seconds: number) => {
    if (seconds <= 0) return "Round deadline reached";
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) {
      return `${days} ${days === 1 ? "day" : "days"}, ${hours} ${hours === 1 ? "hr" : "hrs"}`;
    }
    if (hours > 0) {
      return `${hours} ${hours === 1 ? "hour" : "hours"}, ${minutes} min`;
    }
    return `${minutes} minutes remaining`;
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Top Header / Greeting Bar */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-[var(--kolo-border)]">
        <div>
          <h1 className="text-3xl sm:text-4xl font-serif tracking-tight text-[var(--kolo-ink)]">
            Community Savings Ledger
          </h1>
          <p className="text-sm text-[var(--kolo-ink-muted)] mt-1">
            Real-time rotating savings circles verified on Solana Devnet
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => refreshCircles()}
            className="px-3.5 py-2 text-xs font-medium text-[var(--kolo-ink-muted)] bg-[var(--kolo-surface)] border border-[var(--kolo-border)] rounded-full hover:bg-[var(--kolo-surface-subtle)] hover:text-[var(--kolo-ink)] transition-colors shadow-xs"
            title="Refresh on-chain data"
          >
            Refresh chain data
          </button>
          {onCreateCircleClick && (
            <button
              onClick={onCreateCircleClick}
              className="px-4 py-2 text-sm font-medium text-white bg-[var(--kolo-terracotta)] hover:bg-[var(--kolo-terracotta-hover)] rounded-full shadow-sm transition-all"
            >
              Start a new circle
            </button>
          )}
        </div>
      </header>

      {/* Loading Skeleton */}
      {isLoading && circles.length === 0 && (
        <div className="p-12 text-center bg-[var(--kolo-surface)] border border-[var(--kolo-border)] rounded-2xl animate-pulse space-y-4">
          <div className="w-12 h-12 mx-auto rounded-full bg-[var(--kolo-surface-subtle)]" />
          <p className="font-serif text-lg text-[var(--kolo-ink)]">
            Reading ledger from Solana Devnet...
          </p>
          <p className="text-xs text-[var(--kolo-ink-muted)]">
            Querying active circles, round positions, and vault balances
          </p>
        </div>
      )}

      {/* Empty State: No Circles On-Chain Yet */}
      {!isLoading && circles.length === 0 && (
        <section className="bg-[var(--kolo-surface)] border border-[var(--kolo-border)] rounded-3xl p-8 sm:p-12 text-center shadow-xs">
          <div className="max-w-md mx-auto space-y-6">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[var(--kolo-clay-soft)] flex items-center justify-center text-[var(--kolo-terracotta)]">
              <svg
                className="w-8 h-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.75}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-serif text-[var(--kolo-ink)]">
                No active savings circles found
              </h2>
              <p className="text-sm text-[var(--kolo-ink-muted)] leading-relaxed">
                Be the first to start an Ajo circle on Devnet or join an existing circle with an invite link.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              {onCreateCircleClick && (
                <button
                  onClick={onCreateCircleClick}
                  className="w-full sm:w-auto px-6 py-3 text-sm font-medium text-white bg-[var(--kolo-terracotta)] hover:bg-[var(--kolo-terracotta-hover)] rounded-full shadow-sm transition-all"
                >
                  Start a new circle
                </button>
              )}
              {onJoinInviteClick && (
                <button
                  onClick={onJoinInviteClick}
                  className="w-full sm:w-auto px-6 py-3 text-sm font-medium text-[var(--kolo-ink)] bg-[var(--kolo-surface-subtle)] hover:bg-[var(--kolo-border)] rounded-full transition-colors"
                >
                  Join with invite link
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Main Dashboard Layout with On-Chain Circles */}
      {circles.length > 0 && activeCircle && (
        <div className="space-y-8">
          {/* Hero Anchor: Whose turn is next and when */}
          <section className="bg-[var(--kolo-surface)] border border-[var(--kolo-border)] rounded-3xl p-6 sm:p-8 shadow-sm space-y-6 relative overflow-hidden">
            {/* Top Badge: Circle identifier & round */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[var(--kolo-sage)]" />
                <span className="text-xs font-medium text-[var(--kolo-ink-muted)]">
                  Circle #{activeCircle.circle.circleId.toString()}
                </span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-[var(--kolo-clay-soft)] text-[var(--kolo-terracotta)] font-medium">
                  {activeCircle.statusLabel === "Active"
                    ? `Round ${activeCircle.circle.currentRound + 1} of ${activeCircle.circle.maxMembers}`
                    : activeCircle.statusLabel}
                </span>
              </div>

              {/* Circle Selector dropdown if multiple circles exist */}
              {circles.length > 1 && (
                <select
                  value={selectedCircleIndex}
                  onChange={(e) => setSelectedCircleIndex(Number(e.target.value))}
                  className="text-xs bg-[var(--kolo-surface-subtle)] border border-[var(--kolo-border)] rounded-lg px-3 py-1.5 text-[var(--kolo-ink)] focus:outline-none"
                >
                  {circles.map((c, idx) => (
                    <option key={c.circleAddress} value={idx}>
                      Circle #{c.circle.circleId.toString()} ({c.statusLabel})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Split Highlight: Next Pot Payout & Your Status */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              {/* Box 1: Next Pot Payout (The communal focal point) */}
              <div className="bg-[var(--kolo-surface-subtle)] border border-[var(--kolo-border)] rounded-2xl p-6 space-y-4">
                <p className="text-xs font-medium text-[var(--kolo-ink-muted)]">
                  Next pot payout
                </p>

                <div className="space-y-1">
                  <div className="text-3xl sm:text-4xl font-serif text-[var(--kolo-ink)]">
                    ${activeCircle.currentPotAmountUsdc.toLocaleString()} <span className="text-lg font-sans font-normal text-[var(--kolo-ink-muted)]">USDC</span>
                  </div>
                  <p className="text-xs text-[var(--kolo-ink-muted)]">
                    Contribution: ${activeCircle.contributionAmountUsdc} USDC every {activeCircle.frequencyDays} {activeCircle.frequencyDays === 1 ? "day" : "days"}
                  </p>
                </div>

                <div className="pt-2 border-t border-[var(--kolo-border)] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--kolo-ink-muted)]">Next recipient</span>
                    <span className="font-medium text-[var(--kolo-ink)]">
                      {activeCircle.isUserNextRecipient ? (
                        <span className="text-[var(--kolo-terracotta)] font-semibold">
                          You are up next!
                        </span>
                      ) : activeCircle.nextRecipientAddress ? (
                        ellipsify(activeCircle.nextRecipientAddress)
                      ) : (
                        "Pending seat fill"
                      )}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--kolo-ink-muted)]">Payout timing</span>
                    <span className="font-medium text-[var(--kolo-ink)]">
                      {activeCircle.statusLabel === "Active"
                        ? formatCountdown(activeCircle.secondsRemainingInRound)
                        : "Starts once circle is full"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Box 2: Your Status this Round */}
              <div className="bg-[var(--kolo-surface-subtle)] border border-[var(--kolo-border)] rounded-2xl p-6 space-y-4">
                <p className="text-xs font-medium text-[var(--kolo-ink-muted)]">
                  Your status this round
                </p>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--kolo-ink-muted)]">Round contribution</span>
                    {activeCircle.hasUserContributedThisRound ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--kolo-sage-soft)] text-[var(--kolo-sage)]">
                        Paid for this round
                      </span>
                    ) : activeCircle.isMember ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--kolo-ochre-soft)] text-[var(--kolo-ochre)]">
                        Payment due (${activeCircle.contributionAmountUsdc} USDC)
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--kolo-ink-muted)]">
                        Not joined yet
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--kolo-ink-muted)]">Collateral stake</span>
                    {activeCircle.isUserStaked ? (
                      <span className="text-xs font-medium text-[var(--kolo-ink)]">
                        ${activeCircle.stakeAmountUsdc} USDC locked safely
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--kolo-ink-muted)]">
                        None locked
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--kolo-ink-muted)]">Your payout position</span>
                    <span className="text-xs font-medium text-[var(--kolo-ink)]">
                      {activeCircle.userPayoutRound !== null ? (
                        activeCircle.userPayoutRound === activeCircle.circle.currentRound ? (
                          <span className="text-[var(--kolo-terracotta)] font-semibold">
                            Current round (Turn #{activeCircle.userPayoutRound + 1})
                          </span>
                        ) : (
                          `Round ${activeCircle.userPayoutRound + 1}`
                        )
                      ) : (
                        "Unassigned"
                      )}
                    </span>
                  </div>
                </div>

                {/* Primary Action on Active Circle */}
                {onSelectCircle && (
                  <div className="pt-2">
                    <button
                      onClick={() => onSelectCircle(activeCircle)}
                      className="w-full py-2.5 text-xs font-medium text-center text-white bg-[var(--kolo-terracotta)] hover:bg-[var(--kolo-terracotta-hover)] rounded-xl transition-all shadow-xs"
                    >
                      Open circle savings ledger
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Payout Rotation Order Track */}
            <div className="space-y-3 pt-2">
              <p className="text-xs font-medium text-[var(--kolo-ink-muted)]">
                Payout rotation order
              </p>

              <div className="flex flex-wrap items-center gap-2">
                {activeCircle.circle.payoutOrder && activeCircle.circle.payoutOrder.length > 0 ? (
                  activeCircle.circle.payoutOrder.map((memberAddr, index) => {
                    const isCurrentTurn = index === activeCircle.circle.currentRound;
                    const isPastTurn = index < activeCircle.circle.currentRound;
                    const isUser = Boolean(walletAddress && memberAddr === walletAddress);

                    return (
                      <div
                        key={`${memberAddr}-${index}`}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border transition-all ${
                          isCurrentTurn
                            ? "bg-[var(--kolo-clay-soft)] border-[var(--kolo-terracotta)] text-[var(--kolo-terracotta)] font-semibold shadow-xs"
                            : isPastTurn
                            ? "bg-[var(--kolo-surface-subtle)] border-transparent text-[var(--kolo-ink-muted)] opacity-60"
                            : "bg-[var(--kolo-surface)] border-[var(--kolo-border)] text-[var(--kolo-ink)]"
                        }`}
                      >
                        <span className="w-4 h-4 rounded-full bg-[var(--kolo-border)] flex items-center justify-center text-[10px]">
                          {index + 1}
                        </span>
                        <span>
                          {isUser ? "You" : ellipsify(memberAddr)}
                          {isCurrentTurn && " (Up next)"}
                          {isPastTurn && " (Paid)"}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-[var(--kolo-ink-muted)] italic">
                    Rotation order will lock once all {activeCircle.circle.maxMembers} members join.
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Grid Layout: All Circles List & Quick Guide */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: All Circles List (2 cols on desktop) */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-serif text-[var(--kolo-ink)]">
                  Your savings circles ({circles.length})
                </h2>
              </div>

              <div className="space-y-3">
                {circles.map((item) => {
                  const isSelected = item.circleAddress === activeCircle.circleAddress;

                  return (
                    <div
                      key={item.circleAddress}
                      onClick={() => onSelectCircle && onSelectCircle(item)}
                      className={`p-5 rounded-2xl border transition-all cursor-pointer bg-[var(--kolo-surface)] ${
                        isSelected
                          ? "border-[var(--kolo-terracotta)] ring-1 ring-[var(--kolo-terracotta)] shadow-xs"
                          : "border-[var(--kolo-border)] hover:border-[var(--kolo-ink-muted)]"
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-serif font-medium text-base text-[var(--kolo-ink)]">
                              Circle #{item.circle.circleId.toString()}
                            </span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                item.statusLabel === "Active"
                                  ? "bg-[var(--kolo-sage-soft)] text-[var(--kolo-sage)]"
                                  : item.statusLabel === "Completed"
                                  ? "bg-[var(--kolo-surface-subtle)] text-[var(--kolo-ink-muted)]"
                                  : "bg-[var(--kolo-ochre-soft)] text-[var(--kolo-ochre)]"
                              }`}
                            >
                              {item.statusLabel}
                            </span>
                          </div>

                          <p className="text-xs text-[var(--kolo-ink-muted)]">
                            ${item.contributionAmountUsdc} USDC / {item.frequencyDays} {item.frequencyDays === 1 ? "day" : "days"} * {item.circle.memberCount} of {item.circle.maxMembers} members joined
                          </p>
                        </div>

                        <div className="flex items-center gap-4 text-right">
                          <div className="space-y-0.5">
                            <p className="text-xs text-[var(--kolo-ink-muted)]">
                              Round pot
                            </p>
                            <p className="font-serif text-sm text-[var(--kolo-ink)]">
                              ${item.currentPotAmountUsdc.toLocaleString()} USDC
                            </p>
                          </div>

                          <a
                            href={getExplorerUrl(`/account/${item.circleAddress}`)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="p-2 text-[var(--kolo-ink-muted)] hover:text-[var(--kolo-ink)] hover:bg-[var(--kolo-surface-subtle)] rounded-lg transition-colors"
                            title="View on Solana Explorer"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Rules of Kolo & Quick Actions */}
            <div className="space-y-6">
              <div className="bg-[var(--kolo-surface)] border border-[var(--kolo-border)] rounded-2xl p-6 space-y-4">
                <h3 className="text-sm font-serif text-[var(--kolo-ink)]">
                  Rules of the Kolo ledger
                </h3>

                <ul className="space-y-3 text-xs text-[var(--kolo-ink-muted)]">
                  <li className="flex gap-2">
                    <span className="font-serif text-[var(--kolo-terracotta)] font-bold">1.</span>
                    <span><strong>1x Collateral Stake</strong> is locked when joining and refunded in full after all rounds complete.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-serif text-[var(--kolo-terracotta)] font-bold">2.</span>
                    <span><strong>60-hour grace period</strong> triggers automatically with a 7% late fee if a round deadline is missed.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-serif text-[var(--kolo-terracotta)] font-bold">3.</span>
                    <span><strong>Default protection:</strong> If unpaid after grace period, locked stake is forfeited directly into the current round pot.</span>
                  </li>
                </ul>
              </div>

              {/* Share / Invite Banner */}
              <div className="bg-[var(--kolo-clay-soft)] border border-[var(--kolo-terracotta)]/20 rounded-2xl p-6 space-y-3">
                <h3 className="text-sm font-serif text-[var(--kolo-terracotta)] font-medium">
                  Invite your trusted circle
                </h3>
                <p className="text-xs text-[var(--kolo-ink-muted)] leading-relaxed">
                  Rotating savings thrive on mutual trust. Share your circle&rsquo;s invite link with family, coworkers, or community builders.
                </p>
                {onJoinInviteClick && (
                  <button
                    onClick={onJoinInviteClick}
                    className="w-full py-2 text-xs font-medium text-[var(--kolo-terracotta)] bg-white border border-[var(--kolo-terracotta)]/30 rounded-xl hover:bg-[var(--kolo-clay-soft)] transition-colors"
                  >
                    Open invite prompt
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
