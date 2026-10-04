import {
  isSolanaError,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
} from "@solana/kit";

export const KOLO_ERROR_MESSAGES: Record<number, string> = {
  6000: "Invalid member count. Must be between 2 and 16.",
  6001: "Invalid contribution amount. Must be greater than zero.",
  6002: "Invalid frequency schedule.",
  6003: "Invalid payout order list.",
  6004: "Circle is not currently forming.",
  6005: "Circle is already full (all seats occupied).",
  6006: "Circle is not currently active.",
  6007: "Circle has not completed all rounds yet.",
  6008: "Circle is not cancelled.",
  6009: "Member has defaulted and cannot perform this action.",
  6010: "You have already contributed for this round.",
  6011: "Round contribution deadline has not passed yet.",
  6012: "Grace period is already active for this member.",
  6013: "Grace period has expired. Member must be processed for default.",
  6014: "Grace period has not expired yet.",
  6015: "Selected payout recipient has defaulted.",
  6016: "Recipient has already received their payout pot.",
  6017: "Recipient is not the expected payout recipient for this round.",
  6018: "No funds collected in vault to release.",
  6019: "Stake collateral has already been refunded.",
  6020: "No collateral stake available to refund.",
  6021: "Unauthorized action.",
  6022: "Math overflow occurred in calculation.",
};

export function parseTransactionError(err: unknown): string {
  // Wallet rejection (comes from wallet-standard or privy)
  if (err instanceof Error && (err.message.includes("User rejected") || err.message.includes("rejected"))) {
    return "Transaction was rejected by the wallet.";
  }

  // Check for Anchor custom program error codes (e.g. 6000-6022)
  if (
    isSolanaError(err, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM) &&
    typeof err.context?.code === "number"
  ) {
    const customCode = err.context.code;
    if (KOLO_ERROR_MESSAGES[customCode]) {
      return `Kolo Error (${customCode}): ${KOLO_ERROR_MESSAGES[customCode]}`;
    }
    return `Program Error Code: ${customCode}`;
  }

  // Parse string error messages containing code numbers or Anchor strings
  const rawMessage = getDeepestMessage(err);

  // Check if error contains Anchor custom error code e.g. "custom program error: 0x177a" (6010)
  const hexMatch = rawMessage.match(/custom program error:\s*(0x[0-9a-fA-F]+)/i);
  if (hexMatch && hexMatch[1]) {
    const code = parseInt(hexMatch[1], 16);
    if (KOLO_ERROR_MESSAGES[code]) {
      return `Kolo Error (${code}): ${KOLO_ERROR_MESSAGES[code]}`;
    }
  }

  const decMatch = rawMessage.match(/Error Code:\s*(\w+)|Error Number:\s*(\d+)/i);
  if (decMatch) {
    const code = decMatch[2] ? parseInt(decMatch[2], 10) : undefined;
    if (code && KOLO_ERROR_MESSAGES[code]) {
      return `Kolo Error (${code}): ${KOLO_ERROR_MESSAGES[code]}`;
    }
  }

  if (rawMessage.includes("insufficient funds") || rawMessage.includes("Insufficient balance") || rawMessage.includes("0x1")) {
    return "Insufficient USDC / SOL balance in wallet to pay stake or transaction fees.";
  }

  return rawMessage.length > 200 ? `${rawMessage.slice(0, 200)}...` : rawMessage;
}

function getDeepestMessage(err: unknown): string {
  let deepest = err instanceof Error ? err.message : String(err);
  let current: unknown = err;

  while (current instanceof Error && current.cause) {
    current = current.cause;
    if (current instanceof Error) {
      deepest = current.message;
    }
  }

  return deepest;
}
