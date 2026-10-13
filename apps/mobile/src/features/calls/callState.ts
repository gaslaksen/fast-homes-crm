import { createContext, useContext } from 'react';
import type { CallerId } from './hooks';

export type CallStatus =
  | 'idle'
  | 'connecting'
  | 'ringing'
  | 'connected'
  | 'reconnecting'
  | 'ended';

/** The lead a call is for. Without it the API cannot check DNC or log the call. */
export interface CallLead {
  id: string;
  /** Lead.source when the caller knows it; looked up otherwise. */
  source?: string | null;
}

/** What the agent says happened, for POST /calls/twilio/disposition. */
export interface CallOutcomeInput {
  disposition: string;
  outcome?: string | null;
  objection?: string | null;
  notes?: string;
  followUpAt?: string | null;
}

export interface CallState {
  status: CallStatus;
  muted: boolean;
  /** Display name (or number) of the party being called. */
  peerName: string;
  /** Epoch ms when the call connected, for the duration timer. */
  connectedAt: number | null;
  /** Set when a call fails so the UI can show why. */
  error: string | null;
  /** Numbers this org can call from (empty until loaded, or if none are set up). */
  callerIds: CallerId[];
  /** The number outbound calls present, or null to let the API pick the default. */
  callerId: CallerId | null;
  /** Persisted across launches; pass null to go back to the default. */
  setCallerId: (c: CallerId | null) => void;
  startCall: (toNumber: string, name?: string, lead?: CallLead) => Promise<void>;
  toggleMute: () => Promise<void>;
  hangUp: () => Promise<void>;
  dismiss: () => void;
  /**
   * True when the call just placed was to a surplus lead and reached Twilio,
   * so the end screen asks what happened in the recovery vocabulary.
   */
  needsOutcome: boolean;
  /** Save the outcome against this call. Throws with the API's message on refusal. */
  saveOutcome: (input: CallOutcomeInput) => Promise<void>;
}

export const CallContext = createContext<CallState | undefined>(undefined);

export function useCall(): CallState {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used within CallProvider');
  return ctx;
}
