"use client";

import { useState } from "react";
import { useWalletSession, walletLabel } from "@/app/components/wallet-provider";

export function WalletConnect() {
  const { available, walletAddress, walletName, connect, disconnect, connecting } = useWalletSession();
  const [open, setOpen] = useState(false);

  return (
    <div className="wallet-box">
      <button
        type="button"
        className="theme-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-label="Wallet connect menu"
      >
        {walletLabel(walletName, walletAddress)}
      </button>
      {open ? (
        <div className="wallet-panel card">
          {!walletAddress ? (
            <>
              <p className="muted compact">Select Cardano wallet</p>
              <div className="wallet-list">
                {available.length ? (
                  available.map((item) => (
                    <button
                      type="button"
                      key={item.key}
                      className="btn btn-outline"
                      onClick={() => connect(item.key)}
                      disabled={connecting}
                    >
                      {item.name}
                    </button>
                  ))
                ) : (
                  <p className="muted compact">No CIP-30 wallet detected.</p>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="muted compact">Connected wallet</p>
              <p className="compact"><strong>{walletName}</strong></p>
              <p className="muted compact">{walletAddress}</p>
              <button type="button" className="btn btn-outline" onClick={disconnect}>
                Disconnect
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
