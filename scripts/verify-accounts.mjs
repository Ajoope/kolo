import { address } from "@solana/kit";
import { KOLO_PROGRAM_ID, CIRCLE_DISCRIMINATOR, MEMBER_DISCRIMINATOR, getCircleDecoder, getMemberDecoder } from "../app/lib/kolo/program.ts";

const rpcUrl = "https://api.devnet.solana.com";

async function main() {
  console.log("=== Fetching all Kolo program accounts from Devnet ===");
  console.log("Program ID:", KOLO_PROGRAM_ID);

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "fetch-all-kolo-accounts",
      method: "getProgramAccounts",
      params: [KOLO_PROGRAM_ID, { encoding: "base64" }],
    }),
  });

  const json = await response.json();
  if (!json.result || !Array.isArray(json.result)) {
    console.log("No accounts returned:", JSON.stringify(json));
    return;
  }

  console.log(`Raw accounts returned by RPC: ${json.result.length}`);

  const circleDecoder = getCircleDecoder();
  const memberDecoder = getMemberDecoder();

  const circles = [];
  const members = [];

  for (const item of json.result) {
    const pubkey = address(item.pubkey);
    const dataBase64 = item.account?.data?.[0];
    if (!dataBase64) continue;

    const rawBytes = Uint8Array.from(atob(dataBase64), (c) => c.charCodeAt(0));
    if (rawBytes.length < 8) continue;

    const disc = rawBytes.slice(0, 8);

    if (disc.every((byte, idx) => byte === CIRCLE_DISCRIMINATOR[idx])) {
      try {
        const decoded = circleDecoder.decode(rawBytes);
        circles.push({ pubkey, account: decoded });
      } catch (e) {
        console.warn("Failed to decode Circle:", pubkey, e.message);
      }
    }

    if (disc.every((byte, idx) => byte === MEMBER_DISCRIMINATOR[idx])) {
      try {
        const decoded = memberDecoder.decode(rawBytes);
        members.push({ pubkey, account: decoded });
      } catch (e) {
        console.warn("Failed to decode Member:", pubkey, e.message);
      }
    }
  }

  console.log(`\nDecoded ${circles.length} Circle account(s) and ${members.length} Member account(s):\n`);

  for (const c of circles) {
    console.log("--- Circle ---");
    console.log("  address:", c.pubkey);
    console.log("  circleId:", c.account.circleId.toString());
    console.log("  creator:", c.account.creator);
    console.log("  status:", c.account.status);
    console.log("  maxMembers:", c.account.maxMembers, "memberCount:", c.account.memberCount);
    console.log("  currentRound:", c.account.currentRound);
    console.log("  contributionAmount:", c.account.contributionAmount.toString());
    console.log("  payoutOrder:", c.account.payoutOrder);
  }

  for (const m of members) {
    console.log("--- Member ---");
    console.log("  address:", m.pubkey);
    console.log("  wallet:", m.account.wallet);
    console.log("  circle:", m.account.circle);
    console.log("  isStaked:", m.account.isStaked, "stakeAmount:", m.account.stakeAmount.toString());
    console.log("  hasDefaulted:", m.account.hasDefaulted, "hasReceivedPayout:", m.account.hasReceivedPayout);
  }
}

main().catch(console.error);