"use client";

import { ReactNode, useEffect, useMemo } from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { RPC_URL } from "@/lib/constants";
import { tryCreateDevWallet, DEV_WALLET_NAME } from "@/providers/local-wallet-adapter";

import "@solana/wallet-adapter-react-ui/styles.css";

/** DEV-only: auto-select the local keypair wallet so E2E can drive the UI. */
function DevWalletAutoConnect() {
  const { wallets, wallet, select } = useWallet();
  useEffect(() => {
    if (wallet) return;
    const dev = wallets.find((w) => w.adapter.name === DEV_WALLET_NAME);
    if (dev) select(dev.adapter.name);
  }, [wallets, wallet, select]);
  return null;
}

export function SolanaProvider({ children }: { children: ReactNode }) {
  // Phantom registers via Wallet Standard automatically. The dev keypair
  // adapter is added ONLY when NEXT_PUBLIC_DEV_WALLET_SECRET is set (absent in
  // production → empty list → no headless signer).
  const wallets = useMemo(() => {
    const dev = tryCreateDevWallet();
    return dev ? [dev] : [];
  }, []);
  const devMode = wallets.length > 0;

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {devMode && <DevWalletAutoConnect />}
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
