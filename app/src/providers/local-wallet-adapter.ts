"use client";

/**
 * DEV-ONLY headless wallet adapter backed by a local Keypair.
 *
 * Activated ONLY when `NEXT_PUBLIC_DEV_WALLET_SECRET` is set (a JSON array of
 * the 64-byte secret key). In production that env var is absent, so this
 * adapter is never registered — see solana-provider.tsx. Lets automated E2E
 * drive the real UI (sign without a browser wallet popup). Never ship a
 * funded/real key through this; use a throwaway devnet keypair.
 */
import {
  BaseSignerWalletAdapter,
  WalletReadyState,
  type WalletName,
  type SupportedTransactionVersions,
} from "@solana/wallet-adapter-base";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

export const DEV_WALLET_NAME = "Local Dev Wallet" as WalletName<"Local Dev Wallet">;

// Empty 1x1 SVG — wallet-adapter requires a non-empty icon string.
const ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";

export class LocalKeypairWalletAdapter extends BaseSignerWalletAdapter {
  name = DEV_WALLET_NAME;
  url = "https://localhost";
  icon = ICON;
  readyState = WalletReadyState.Installed;
  supportedTransactionVersions: SupportedTransactionVersions = new Set(["legacy", 0]);

  private readonly _keypair: Keypair;
  private _publicKey: PublicKey | null = null;
  private _connecting = false;

  constructor(keypair: Keypair) {
    super();
    this._keypair = keypair;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  async connect(): Promise<void> {
    if (this.connected || this.connecting) return;
    this._connecting = true;
    this._publicKey = this._keypair.publicKey;
    this._connecting = false;
    this.emit("connect", this._publicKey);
  }

  async disconnect(): Promise<void> {
    this._publicKey = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    if (transaction instanceof VersionedTransaction) {
      transaction.sign([this._keypair]);
    } else {
      transaction.partialSign(this._keypair);
    }
    return transaction;
  }
}

/** Build the dev adapter from the env secret, or null if unset/invalid. */
export function tryCreateDevWallet(): LocalKeypairWalletAdapter | null {
  const secret = process.env.NEXT_PUBLIC_DEV_WALLET_SECRET;
  if (!secret) return null;
  try {
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret) as number[]));
    return new LocalKeypairWalletAdapter(kp);
  } catch {
    return null;
  }
}
