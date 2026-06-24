import { createContext, useContext } from 'react';

export type CallStatus =
  | 'idle'
  | 'connecting'
  | 'ringing'
  | 'connected'
  | 'reconnecting'
  | 'ended';

export interface CallState {
  status: CallStatus;
  muted: boolean;
  /** Display name (or number) of the party being called. */
  peerName: string;
  /** Epoch ms when the call connected, for the duration timer. */
  connectedAt: number | null;
  /** Set when a call fails so the UI can show why. */
  error: string | null;
  startCall: (toNumber: string, name?: string) => Promise<void>;
  toggleMute: () => Promise<void>;
  hangUp: () => Promise<void>;
  dismiss: () => void;
}

export const CallContext = createContext<CallState | undefined>(undefined);

export function useCall(): CallState {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used within CallProvider');
  return ctx;
}
