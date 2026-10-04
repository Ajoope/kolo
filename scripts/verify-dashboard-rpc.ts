import { fetchAllUserCircles } from "../app/lib/kolo/fetcher";
import { CircleStatus } from "../app/generated/vault/types/circleStatus";

async function main() {
  console.log("=== Testing Kolo Devnet Account Fetcher & Decoder ===");
  console.log("CircleStatus Enum mappings:", {
    Forming: CircleStatus.Forming,
    Active: CircleStatus.Active,
    Completed: CircleStatus.Completed,
    Cancelled: CircleStatus.Cancelled,
  });

  const circles = await fetchAllUserCircles("devnet");
  console.log(`Found ${circles.length} on-chain Circle(s) on Solana Devnet.`);

  for (const c of circles) {
    console.log({
      address: c.circleAddress,
      circleId: c.circle.circleId.toString(),
      statusRaw: c.circle.status,
      statusLabel: c.statusLabel,
      maxMembers: c.circle.maxMembers,
      memberCount: c.circle.memberCount,
      currentRound: c.circle.currentRound,
      currentPotAmountUsdc: c.currentPotAmountUsdc,
      nextRecipient: c.nextRecipientAddress,
      payoutOrder: c.circle.payoutOrder,
    });
  }
}

main().catch(console.error);
