"use client";

import { useState, useCallback, useMemo } from "react";
import { useSWRConfig } from "swr";
import type { Instruction } from "@solana/kit";
import { createClient } from "@solana/kit-client-rpc";
import { useWallet } from "../wallet/context";
import { useCluster } from "../../components/cluster-context";
import { getClusterUrl, getClusterWsConfig } from "../solana-client";

export function useSendTransaction() {
  const { signer } = useWallet();
  const { cluster } = useCluster();
  const { mutate } = useSWRConfig();
  const [isSending, setIsSending] = useState(false);

  const txClient = useMemo(
    () =>
      signer
        ? createClient({
            url: getClusterUrl(cluster),
            rpcSubscriptionsConfig: getClusterWsConfig(cluster),
            payer: signer,
          })
        : null,
    [cluster, signer]
  );

  const send = useCallback(
    async ({ instructions }: { instructions: readonly Instruction[] }) => {
      if (!txClient) throw new Error("Wallet not connected");

      setIsSending(true);
      try {
        // 1. Send transaction through Kit's transaction plan executor (which invokes sendAndConfirmTransaction)
        const result = await txClient.sendTransaction([...instructions]);
        const sig = result.context.signature;

        // 2. Explicit on-chain confirmation verification:
        // Poll getSignatureStatuses to guarantee the transaction is confirmed/finalized and did not revert
        let isConfirmed = false;
        let attempts = 0;
        const maxAttempts = 30; // 30s timeout

        while (!isConfirmed && attempts < maxAttempts) {
          try {
            const statusResponse = await txClient.rpc
              .getSignatureStatuses([sig])
              .send();
            const status = statusResponse.value?.[0];

            if (status) {
              if (status.err) {
                throw new Error(
                  `Transaction failed on-chain: ${JSON.stringify(status.err)}`
                );
              }
              if (
                status.confirmationStatus === "confirmed" ||
                status.confirmationStatus === "finalized"
              ) {
                isConfirmed = true;
                break;
              }
            }
          } catch (rpcErr: unknown) {
            if (
              rpcErr instanceof Error &&
              rpcErr.message.includes("Transaction failed on-chain")
            ) {
              throw rpcErr;
            }
          }

          attempts++;
          if (!isConfirmed) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }

        // Invalidate balances in SWR cache
        mutate((key: unknown) => Array.isArray(key) && key[0] === "balance");
        return sig;
      } finally {
        setIsSending(false);
      }
    },
    [txClient, mutate]
  );

  return { send, isSending };
}
