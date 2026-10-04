import { readFileSync } from "node:fs";
import { createKeyPairSignerFromBytes } from "@solana/kit";

const bytes = new Uint8Array(JSON.parse(readFileSync(process.argv[2], "utf-8")));
const signer = await createKeyPairSignerFromBytes(bytes);
console.log("Keypair pubkey:", signer.address);