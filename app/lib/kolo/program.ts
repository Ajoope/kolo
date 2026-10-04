import {
  type Address,
  type ProgramDerivedAddressBump,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";

// Re-export generated program client types and instructions from Codama
export * from "../../generated/vault";

// Re-export official SPL Token and Associated Token Program utilities
export {
  findAssociatedTokenPda,
  getCreateAssociatedTokenInstruction,
  getCreateAssociatedTokenInstruction as getCreateAssociatedTokenAccountInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
};

export const KOLO_PROGRAM_ID = address(
  "BVNGa6bQ7xPoiXd3Gz1JANVBVugbXD1Q5WQaAYAZ2y5c"
);

export const TOKEN_PROGRAM_ID = TOKEN_PROGRAM_ADDRESS;
export const ASSOCIATED_TOKEN_PROGRAM_ID = ASSOCIATED_TOKEN_PROGRAM_ADDRESS;
export const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");

// Standard Devnet Mock USDC Mint
export const DEVNET_USDC_MINT = address(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

const addressEncoder = getAddressEncoder();

// Helper: Convert u64 number or bigint to 8-byte little-endian Uint8Array
export function u64ToLeBytes(value: bigint | number): Uint8Array {
  const bn = BigInt(value);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, bn, true);
  return new Uint8Array(buffer);
}

// Helper: Convert i64 number or bigint to 8-byte little-endian Uint8Array
export function i64ToLeBytes(value: bigint | number): Uint8Array {
  const bn = BigInt(value);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigInt64(0, bn, true);
  return new Uint8Array(buffer);
}

/**
 * Derives the Circle PDA: seeds = [b"circle", creator, circle_id.to_le_bytes()]
 */
export async function getCirclePda(
  creator: Address,
  circleId: bigint | number
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
  return await getProgramDerivedAddress({
    programAddress: KOLO_PROGRAM_ID,
    seeds: [
      new TextEncoder().encode("circle"),
      addressEncoder.encode(creator),
      u64ToLeBytes(circleId),
    ],
  });
}

/**
 * Derives the Circle Vault Token PDA: seeds = [b"vault", circle]
 */
export async function getVaultPda(
  circleAddress: Address
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
  return await getProgramDerivedAddress({
    programAddress: KOLO_PROGRAM_ID,
    seeds: [
      new TextEncoder().encode("vault"),
      addressEncoder.encode(circleAddress),
    ],
  });
}

/**
 * Derives the Member PDA: seeds = [b"member", circle, member_wallet]
 */
export async function getMemberPda(
  circleAddress: Address,
  memberWallet: Address
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
  return await getProgramDerivedAddress({
    programAddress: KOLO_PROGRAM_ID,
    seeds: [
      new TextEncoder().encode("member"),
      addressEncoder.encode(circleAddress),
      addressEncoder.encode(memberWallet),
    ],
  });
}

/**
 * Derives the Associated Token Account (ATA) using @solana-program/token's findAssociatedTokenPda
 */
export async function getAssociatedTokenAddress(
  owner: Address,
  mint: Address
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
  return await findAssociatedTokenPda({
    owner,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
}

/**
 * Checks on-chain if an account/ATA exists via RPC.
 */
export async function checkAccountExists(
  rpcUrl: string,
  accountAddress: Address
): Promise<boolean> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "check-account",
        method: "getAccountInfo",
        params: [accountAddress, { encoding: "base64" }],
      }),
    });
    const json = await res.json();
    return json.result?.value !== null && json.result?.value !== undefined;
  } catch (e) {
    console.warn("Could not verify account existence on-chain:", e);
    return false;
  }
}
