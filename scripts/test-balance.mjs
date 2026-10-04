import { createSolanaClient } from "./app/lib/solana-client";
import { address } from "@solana/kit";

const client = createSolanaClient("devnet");
const addr = address("CEfnyG8hgY7EgtHXciNWKn3vxF7G1Zsp4ejfkfga4vsz");

console.log("Calling getBalance via kit-plugin-rpc...");
try {
  const { value } = await client.rpc.getBalance(addr).send();
  console.log("SUCCESS:", value.toString(), "lamports =", (Number(value) / 1e9), "SOL");
} catch (err) {
  console.error("FAILED:", err);
}