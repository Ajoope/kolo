"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { PropsWithChildren } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { ClusterProvider } from "./cluster-context";
import { WalletProvider } from "../lib/wallet/context";
import { SolanaClientProvider } from "../lib/solana-client-context";

export function Providers({ children }: PropsWithChildren) {
  const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cl1234567890abcdefghijklm";

  return (
    <ThemeProvider attribute="class" defaultTheme="dark">
      <PrivyProvider
        appId={privyAppId}
        config={{
          loginMethods: ["email", "wallet"],
          appearance: {
            theme: "dark",
            accentColor: "#10b981",
          },
          embeddedWallets: {
            solana: {
              createOnLogin: "users-without-wallets",
            },
          },
        }}
      >
        <ClusterProvider>
          <SolanaClientProvider>
            <WalletProvider>{children}</WalletProvider>
          </SolanaClientProvider>
          <Toaster position="bottom-right" richColors />
        </ClusterProvider>
      </PrivyProvider>
    </ThemeProvider>
  );
}

