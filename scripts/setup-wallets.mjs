import { createKeyPairSignerFromBytes, createSolanaRpc, lamports } from "@solana/kit";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rpc = createSolanaRpc("https://api.devnet.solana.com");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const wallet1Path = resolve(os.homedir(), ".config", "solana", "id.json");
const wallet1Bytes = new Uint8Array(JSON.parse(readFileSync(wallet1Path, "utf-8")));
const wallet1 = await createKeyPairSignerFromBytes(wallet1Bytes);
console.log("Wallet 1:", wallet1.address);

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const privBytes = new Uint8Array(privateKey.export({ type: "pkcs8", format: "der" }).slice(-32));
const pubBytes = new Uint8Array(publicKey.export({ type: "spki", format: "der" }).slice(-32));
const wallet2Bytes = new Uint8Array(64);
wallet2Bytes.set(privBytes, 0);
wallet2Bytes.set(pubBytes, 32);
const wallet2 = await createKeyPairSignerFromBytes(wallet2Bytes);
writeFileSync(join(__dirname, "..", "anchor", "target", "deploy", "member2-keypair.json"), JSON.stringify(Array.from(wallet2Bytes)));
console.log("Wallet 2:", wallet2.address);

// Try airdrop via CLI-compatible raw requestAirdrop
const airdropAmount = lamports(2_000_000_000n).toString();
let sig;
let lastErr;
for (let attempt = 1; attempt <= 5; attempt++) {
  console.log(`Airdrop attempt ${attempt}...`);
  try {
    const res = await fetch("https://api.devnet.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "airdrop",
        method: "requestAirdrop",
        params: [wallet2.address, airdropAmount],
      }),
    });
    const json = await res.json();
    if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
    sig = json.result;
    console.log("Airdrop sig:", sig);
    lastErr = null;
    break;
  } catch (err) {
    lastErr = err;
    console.warn(`Airdrop attempt ${attempt} failed:`, err.message ?? err);
    if (attempt < 5) await sleep(5000 * attempt);
  }
}
if (!sig) throw lastErr ?? new Error("All airdrop attempts failed");

// Wait for confirmation
console.log("Waiting for airdrop confirmation...");
for (let attempt = 0; attempt < 30; attempt++) {
  const statuses = await rpc.getSignatureStatuses([sig]).send();
  const status = statuses.value?.[0];
  if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
    if (status.err) throw new Error(`Airdrop failed on-chain: ${JSON.stringify(status.err)}`);
    console.log("Airdrop confirmed!");
    break;
  }
  await sleep(1000);
}

const [balance1, balance2] = await Promise.all([
  rpc.getBalance(wallet1.address).send(),
  rpc.getBalance(wallet2.address).send(),
]);
console.log(`Wallet 1 balance: ${balance1.value / 1e9} SOL`);
console.log(`Wallet 2 balance: ${balance2.value / 1e9} SOL`);
console.log("\nSetup complete.");