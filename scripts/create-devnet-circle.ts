import fs from "fs";
import path from "path";
import os from "os";
import {
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import {
  DEVNET_USDC_MINT,
  getCirclePda,
  getVaultPda,
  getCreateCircleInstruction,
} from "../app/lib/kolo/program";

async function main() {
  console.log("=== Creating Real On-Chain Circle on Solana Devnet ===");

  const rpc = createSolanaRpc("https://api.devnet.solana.com");
  const rpcSubscriptions = createSolanaRpcSubscriptions("wss://api.devnet.solana.com");
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });

  // Load the funded keypair (1 SOL balance) from local Solana config
  const keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
  console.log("Loading keypair from:", keypairPath);
  const secretKeyBytes = new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, "utf-8")));
  const creator = await createKeyPairSignerFromBytes(secretKeyBytes);
  console.log("Creator Wallet Address:", creator.address);

  // Set Circle parameters: 50 USDC contribution, 7 days frequency, 3 max members
  const circleId = BigInt(Math.floor(Date.now() / 1000));
  const contributionAmount = 50_000_000n; // 50 USDC (6 decimals)
  const frequency = 604800n; // 7 days (7 * 86400)
  const maxMembers = 3;

  const [circlePda] = await getCirclePda(creator.address, circleId);
  const [vaultPda] = await getVaultPda(circlePda);

  console.log("Circle ID:", circleId.toString());
  console.log("Circle PDA Address:", circlePda);
  console.log("Vault PDA Address:", vaultPda);

  const createCircleIx = getCreateCircleInstruction({
    creator,
    circle: circlePda,
    vault: vaultPda,
    usdcMint: DEVNET_USDC_MINT,
    circleId,
    contributionAmount,
    frequency,
    maxMembers,
    payoutOrder: [creator.address],
  });

  console.log("Fetching latest blockhash from Devnet...");
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  console.log("Building and signing transaction message...");
  const txMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(creator, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstruction(createCircleIx, m)
  );

  const signedTx = await signTransactionMessageWithSigners(txMessage);
  const signature = getSignatureFromTransaction(signedTx);
  console.log("Transaction Signature:", signature);

  console.log("Submitting and confirming transaction on Devnet...");
  await sendAndConfirmTransaction(
    signedTx as unknown as Parameters<typeof sendAndConfirmTransaction>[0],
    { commitment: "confirmed" }
  );

  console.log("\n========================================================");
  console.log("SUCCESS! Real Circle created on-chain on Solana Devnet!");
  console.log("Circle PDA:", circlePda);
  console.log("Explorer Link:", `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  console.log("Circle Account Explorer:", `https://explorer.solana.com/address/${circlePda}?cluster=devnet`);
  console.log("========================================================\n");
}

main().catch(console.error);
