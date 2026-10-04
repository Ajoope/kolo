"use client";

import useSWR from "swr";
import { useWallet } from "../wallet/context";
import { useCluster } from "../../components/cluster-context";
import { fetchAllUserCircles, type UnifiedCircleView } from "../kolo/fetcher";

export function useCircles() {
  const { wallet } = useWallet();
  const { cluster } = useCluster();
  const walletAddress = wallet?.account.address;

  const {
    data: circles,
    error,
    isLoading,
    mutate,
  } = useSWR<UnifiedCircleView[]>(
    ["kolo-circles", cluster, walletAddress ?? "anonymous"],
    () => fetchAllUserCircles(cluster, walletAddress),
    {
      refreshInterval: 10000, // auto-refresh every 10 seconds from devnet
      revalidateOnFocus: true,
    }
  );

  return {
    circles: circles ?? [],
    isLoading,
    isError: Boolean(error),
    error,
    refreshCircles: mutate,
  };
}
