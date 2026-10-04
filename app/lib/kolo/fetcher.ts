import { address, type Address } from "@solana/kit";
import {
  KOLO_PROGRAM_ID,
  CIRCLE_DISCRIMINATOR,
  MEMBER_DISCRIMINATOR,
  CircleStatus,
  getCircleDecoder,
  getMemberDecoder,
  type Circle,
  type Member,
} from "./program";
import { getClusterUrl, type ClusterMoniker } from "../solana-client";

export interface OnChainCircleData {
  pubkey: Address;
  account: Circle;
}

export interface OnChainMemberData {
  pubkey: Address;
  account: Member;
}

export interface UnifiedCircleView {
  circleAddress: Address;
  circle: Circle;
  userMemberAccount: Member | null;
  isCreator: boolean;
  isMember: boolean;
  currentPotAmountUsdc: number;
  contributionAmountUsdc: number;
  frequencyDays: number;
  nextRecipientAddress: Address | null;
  isUserNextRecipient: boolean;
  roundDeadlineTimestamp: number;
  secondsRemainingInRound: number;
  hasUserContributedThisRound: boolean;
  isUserStaked: boolean;
  stakeAmountUsdc: number;
  statusLabel: "Forming" | "Active" | "Completed" | "Cancelled";
  userPayoutRound: number | null; // 0-indexed round number where user receives pot
}

/**
 * Fetches all on-chain Circles and Member accounts from Devnet RPC
 */
export async function fetchAllUserCircles(
  cluster: ClusterMoniker,
  userWalletAddress?: Address
): Promise<UnifiedCircleView[]> {
  const rpcUrl = getClusterUrl(cluster);

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "fetch-all-kolo-accounts",
        method: "getProgramAccounts",
        params: [
          KOLO_PROGRAM_ID,
          {
            encoding: "base64",
          },
        ],
      }),
    });

    const json = await response.json();
    if (!json.result || !Array.isArray(json.result)) {
      return [];
    }

    const circleDecoder = getCircleDecoder();
    const memberDecoder = getMemberDecoder();

    const circles: OnChainCircleData[] = [];
    const members: OnChainMemberData[] = [];

    for (const item of json.result) {
      const pubkey = address(item.pubkey);
      const dataBase64 = item.account?.data?.[0];
      if (!dataBase64) continue;

      const rawBytes = Uint8Array.from(atob(dataBase64), (c) => c.charCodeAt(0));
      if (rawBytes.length < 8) continue;

      const disc = rawBytes.slice(0, 8);

      // Match Circle Discriminator
      if (disc.every((byte, idx) => byte === CIRCLE_DISCRIMINATOR[idx])) {
        try {
          const decoded = circleDecoder.decode(rawBytes);
          circles.push({ pubkey, account: decoded });
        } catch (e) {
          console.warn("Failed to decode Circle account:", pubkey, e);
        }
      }

      // Match Member Discriminator
      if (disc.every((byte, idx) => byte === MEMBER_DISCRIMINATOR[idx])) {
        try {
          const decoded = memberDecoder.decode(rawBytes);
          members.push({ pubkey, account: decoded });
        } catch (e) {
          console.warn("Failed to decode Member account:", pubkey, e);
        }
      }
    }

    const nowSecs = Math.floor(Date.now() / 1000);

    // Build unified view list
    const unifiedViews: UnifiedCircleView[] = circles.map(({ pubkey, account: circle }) => {
      // Find matching user member account for this circle
      const userMember = userWalletAddress
        ? members.find(
            (m) =>
              m.account.circle === pubkey &&
              m.account.wallet === userWalletAddress
          )?.account || null
        : null;

      const isCreator = Boolean(userWalletAddress && circle.creator === userWalletAddress);
      const isMember = Boolean(userMember !== null);

      // Determine status label using the numeric enum CircleStatus
      let statusLabel: "Forming" | "Active" | "Completed" | "Cancelled" = "Forming";
      if (circle.status === CircleStatus.Active || (circle.status as unknown) === 1 || (circle.status as unknown) === "Active") {
        statusLabel = "Active";
      } else if (circle.status === CircleStatus.Completed || (circle.status as unknown) === 2 || (circle.status as unknown) === "Completed") {
        statusLabel = "Completed";
      } else if (circle.status === CircleStatus.Cancelled || (circle.status as unknown) === 3 || (circle.status as unknown) === "Cancelled") {
        statusLabel = "Cancelled";
      } else {
        statusLabel = "Forming";
      }

      const isActive = statusLabel === "Active";

      // Contribution & Pot calculations
      const contributionAmountUsdc = Number(circle.contributionAmount) / 1_000_000;
      const roundCollectedUsdc = Number(circle.currentRoundCollected) / 1_000_000;
      const roundForfeitedUsdc = Number(circle.currentRoundForfeitedPool) / 1_000_000;
      const currentPotAmountUsdc = isActive
        ? contributionAmountUsdc * circle.maxMembers + roundForfeitedUsdc
        : roundCollectedUsdc;

      const frequencyDays = Number(circle.frequency) / 86400;

      // Next recipient in payout rotation:
      // Accounts for members who defaulted or already received payouts by scanning forward
      let nextRecipientAddress: Address | null = null;
      if (circle.payoutOrder && circle.payoutOrder.length > 0) {
        for (let i = circle.currentRound; i < circle.payoutOrder.length; i++) {
          const candidateWallet = circle.payoutOrder[i];
          const candidateMemberData = members.find(
            (m) => m.account.circle === pubkey && m.account.wallet === candidateWallet
          );
          if (
            !candidateMemberData ||
            (!candidateMemberData.account.hasDefaulted &&
              !candidateMemberData.account.hasReceivedPayout)
          ) {
            nextRecipientAddress = candidateWallet;
            break;
          }
        }
      }

      const isUserNextRecipient = Boolean(
        userWalletAddress && nextRecipientAddress === userWalletAddress
      );

      // Round deadlines
      const roundStart = Number(circle.currentRoundStart);
      const roundDeadlineTimestamp =
        isActive && roundStart > 0
          ? roundStart + Number(circle.frequency)
          : 0;
      const secondsRemainingInRound = Math.max(0, roundDeadlineTimestamp - nowSecs);

      // User contribution status
      const hasUserContributedThisRound = Boolean(
        userMember && userMember.lastContributedRound === circle.currentRound
      );

      // User payout position
      const userPayoutRound =
        userWalletAddress && circle.payoutOrder
          ? circle.payoutOrder.indexOf(userWalletAddress)
          : null;

      return {
        circleAddress: pubkey,
        circle,
        userMemberAccount: userMember,
        isCreator,
        isMember,
        currentPotAmountUsdc,
        contributionAmountUsdc,
        frequencyDays,
        nextRecipientAddress,
        isUserNextRecipient,
        roundDeadlineTimestamp,
        secondsRemainingInRound,
        hasUserContributedThisRound,
        isUserStaked: Boolean(userMember?.isStaked),
        stakeAmountUsdc: userMember ? Number(userMember.stakeAmount) / 1_000_000 : 0,
        statusLabel,
        userPayoutRound: userPayoutRound !== -1 ? userPayoutRound : null,
      };
    });

    // If user is connected, prioritize circles they are part of or created
    if (userWalletAddress) {
      return unifiedViews.sort((a, b) => {
        if (a.isMember && !b.isMember) return -1;
        if (!a.isMember && b.isMember) return 1;
        return Number(b.circle.circleId) - Number(a.circle.circleId);
      });
    }

    return unifiedViews;
  } catch (err) {
    console.error("Error fetching on-chain Kolo circles:", err);
    return [];
  }
}
