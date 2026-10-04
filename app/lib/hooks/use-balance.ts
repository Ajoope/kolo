"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { type Address, type Lamports } from "@solana/kit";
import { getClusterUrl } from "../solana-client";
import { useCluster } from "../../components/cluster-context";
import { useSolanaClient } from "../solana-client-context";

const BALANCE_TIMEOUT_MS = 8000;

async function fetchBalanceViaRpc(rpcUrl: string, address: string): Promise<Lamports> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BALANCE_TIMEOUT_MS);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "balance",
        method: "getBalance",
        params: [address],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || "RPC error");
    return BigInt(json.result.value) as Lamports;
  } finally {
    clearTimeout(timer);
  }
}

export function useBalance(address?: Address) {
  const { cluster } = useCluster();
  const client = useSolanaClient();

  // The kit-plugin-rpc getBalance().send() path hangs on this network, so the
  // balance is fetched directly via JSON RPC with a hard timeout.
  const rpcUrl = getClusterUrl(cluster);

  const { data, isLoading, error, mutate } = useSWR(
    address ? (["balance", cluster, address] as const) : null,
    async ([, , addr]) => fetchBalanceViaRpc(rpcUrl, addr),
    { refreshInterval: 60_000, revalidateOnFocus: true, dedupingInterval: 30_000 }
  );

  useEffect(() => {
    if (!address) return;

    const abortController = new AbortController();

    const subscribe = async () => {
      try {
        const notifications = await client.rpcSubscriptions
          .accountNotifications(address, { commitment: "confirmed" })
          .subscribe({ abortSignal: abortController.signal });

        for await (const notification of notifications) {
          const lamports = notification.value.lamports;
          mutate(lamports, { revalidate: false });
        }
      } catch {
        // SWR polling and focus revalidation remain as fallback
      }
    };

    void subscribe();

    return () => {
      abortController.abort();
    };
  }, [address, client, mutate]);

  return {
    lamports: (data ?? null) as Lamports | null,
    isLoading,
    error,
    mutate,
  };
}