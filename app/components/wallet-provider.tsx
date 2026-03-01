"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

interface WalletEntry {
  key: string;
  name: string;
}

interface WalletContextValue {
  available: WalletEntry[];
  walletName: string | null;
  walletAddress: string | null;
  connecting: boolean;
  connect: (walletKey: string) => Promise<void>;
  disconnect: () => void;
}

interface Cip30Api {
  getUsedAddresses?: () => Promise<string[]>;
  getChangeAddress?: () => Promise<string>;
}

interface InjectedWallet {
  name?: string;
  enable: () => Promise<Cip30Api>;
}

declare global {
  interface Window {
    cardano?: Record<string, InjectedWallet>;
  }
}

const WalletContext = createContext<WalletContextValue | null>(null);

function loadWallets(): WalletEntry[] {
  if (typeof window === "undefined" || !window.cardano) {
    return [];
  }

  return Object.entries(window.cardano)
    .filter(([, value]) => value && typeof value.enable === "function")
    .map(([key, value]) => ({
      key,
      name: value.name || key
    }));
}

function shortAddress(value: string): string {
  if (value.length <= 22) {
    return value;
  }
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [available, setAvailable] = useState<WalletEntry[]>([]);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    setAvailable(loadWallets());
  }, []);

  const connect = async (walletKey: string): Promise<void> => {
    if (typeof window === "undefined" || !window.cardano) {
      return;
    }

    const wallet = window.cardano[walletKey];
    if (!wallet) {
      return;
    }

    setConnecting(true);
    try {
      const api = await wallet.enable();
      const used = (await api.getUsedAddresses?.()) || [];
      const change = (await api.getChangeAddress?.()) || "";
      const address = used[0] || change || "";

      setWalletName(wallet.name || walletKey);
      setWalletAddress(address || null);

      try {
        window.localStorage.setItem(
          "wallet-session",
          JSON.stringify({
            walletName: wallet.name || walletKey,
            walletAddress: address || null
          })
        );
      } catch {
        // ignore localStorage errors
      }
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    setWalletName(null);
    setWalletAddress(null);
    try {
      window.localStorage.removeItem("wallet-session");
    } catch {
      // ignore localStorage errors
    }
  };

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("wallet-session");
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as { walletName?: string; walletAddress?: string | null };
      setWalletName(parsed.walletName || null);
      setWalletAddress(parsed.walletAddress || null);
    } catch {
      // ignore localStorage errors
    }
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({
      available,
      walletName,
      walletAddress,
      connecting,
      connect,
      disconnect
    }),
    [available, walletName, walletAddress, connecting]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWalletSession(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) {
    throw new Error("useWalletSession must be used inside WalletProvider");
  }
  return value;
}

export function walletLabel(name: string | null, address: string | null): string {
  if (!name && !address) {
    return "Connect Wallet";
  }
  return `${name || "Wallet"} ${address ? shortAddress(address) : ""}`.trim();
}
