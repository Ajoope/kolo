import { createKeyPairSignerFromBytes, createSolanaRpc, lamports, createTransaction, appendTransactionMessageInstructionBytes, setTransactionMessageFeePayer, signTransaction, sendTransaction } from "@solana/kit";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rpc = createSolanaRpc("https://api.devnet.solana.com");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Load both wallets
const wallet1Path = resolve(os.homedir(), ".config", "solana", "id.json");
const wallet1Bytes = new Uint8Array(JSON.parse(readFileSync(wallet1Path, "utf-8")));
const wallet1 = await createKeyPairSignerFromBytes(wallet1Bytes);

const wallet2Bytes = new Uint8Array(JSON.parse(readFileSync(join(__dirname, "..", "anchor", "target", "deploy", "member2-keypair.json"), "utf-8")));
const wallet2 = await createKeyPairSignerFromBytes(wallet2Bytes);

console.log("Wallet 1:", wallet1.address);
console.log("Wallet 2:", wallet2.address);

// Transfer 0.5 SOL from wallet 1 to wallet 2 for gas
console.log("\nTransferring 0.5 SOL from wallet 1 to wallet 2...");
const transferAmount = lamports(500_000_000n);

// Build a simple system program transfer instruction manually
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const transferIxData = new Uint8Array(8 + 8 + 8);
const view = new DataView(transferIxData.buffer);
view.setBigUint64(0, 2n, true); // Transfer discriminator
view.setBigUint64(8, BigInt(transferAmount), true); // lamports
view.setBigUint64(16, BigInt(transferAmount), true); // same value

// Actually use the proper system program transfer format
const transferData = new Uint8Array(8 + 8 + 8);
const dv = new DataView(transferData.buffer);
dv.setBigUint64(0, 2n, true); // Transfer = 2
dv.setBigUint64(8, BigInt(transferAmount), true);

const transferIx = {
  programAddress: SYSTEM_PROGRAM_ID,
  accounts: [
    { address: wallet1.address, role: 3 }, // writable signer
    { address: wallet2.address, role: 1 }, // writable
    { address: SYSTEM_PROGRAM_ID, role: 0 }, // program
  ],
  data: transferData,
};

const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
const message = appendTransactionMessageInstructionBytes(
  transferIx,
  await createTransaction({ version: 0 })
);
const signedMessage = setTransactionMessageFeePayer(wallet1.address, message);
const signedTx = await signTransaction([wallet1], signedMessage);
const sig = await sendTransaction(signedTx);
console.log("Transfer signature:", sig);

// Wait for confirmation
for (let attempt = 0; attempt < 30; attempt++) {
  const statuses = await rpc.getSignatureStatuses([sig]).send();
  const status = statuses.value?.[0];
  if (status?.confirmationStatus === "confirmed" || status?.ConfirmationStatus === "finalized") {
    if (status.err) throw new Error(`Transfer failed: ${JSON.stringify(status.err)}`);
    console.log("Transfer confirmed!");
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
console.log("\nFunding complete.");