import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Voice, Call } from '@twilio/voice-react-native-sdk';
import { api } from '@/lib/api';
import { ActiveCallScreen } from './ActiveCallScreen';

export type CallStatus =
  | 'idle'
  | 'connecting'
  | 'ringing'
  | 'connected'
  | 'reconnecting'
  | 'ended';

interface CallState {
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

const CallContext = createContext<CallState | undefined>(undefined);

export function CallProvider({ children }: { children: React.ReactNode }) {
  const voiceRef = useRef<Voice | null>(null);
  const callRef = useRef<Call | null>(null);

  const [status, setStatus] = useState<CallStatus>('idle');
  const [muted, setMuted] = useState(false);
  const [peerName, setPeerName] = useState('');
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    voiceRef.current = new Voice();
    return () => {
      callRef.current?.disconnect().catch(() => {});
    };
  }, []);

  const attach = useCallback((call: Call) => {
    callRef.current = call;
    call.on(Call.Event.Ringing, () => setStatus('ringing'));
    call.on(Call.Event.Connected, () => {
      setStatus('connected');
      setConnectedAt(Date.now());
    });
    call.on(Call.Event.Reconnecting, () => setStatus('reconnecting'));
    call.on(Call.Event.Disconnected, () => {
      setStatus('ended');
      callRef.current = null;
    });
    call.on(Call.Event.ConnectFailure, (e: any) => {
      setError(e?.message || 'Call failed to connect');
      setStatus('ended');
      callRef.current = null;
    });
  }, []);

  const startCall = useCallback(
    async (toNumber: string, name?: string) => {
      if (status !== 'idle' && status !== 'ended') return; // a call is already up
      setError(null);
      setMuted(false);
      setConnectedAt(null);
      setPeerName(name || toNumber);
      setStatus('connecting');
      try {
        const { data } = await api.post('/calls/twilio/token');
        if (!data?.configured || !data?.token) {
          throw new Error('Calling is not configured on the server.');
        }
        const call = await voiceRef.current!.connect(data.token, {
          params: { To: toNumber },
        });
        attach(call);
      } catch (e: any) {
        setError(e?.response?.data?.error || e?.message || 'Could not start the call.');
        setStatus('ended');
      }
    },
    [status, attach],
  );

  const toggleMute = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    const next = !muted;
    try {
      await call.mute(next);
      setMuted(next);
    } catch {
      // ignore — leave the toggle as-is
    }
  }, [muted]);

  const hangUp = useCallback(async () => {
    try {
      await callRef.current?.disconnect();
    } catch {
      // already gone
    }
  }, []);

  const dismiss = useCallback(() => {
    setStatus('idle');
    setConnectedAt(null);
    setError(null);
    setPeerName('');
  }, []);

  const value = useMemo<CallState>(
    () => ({
      status,
      muted,
      peerName,
      connectedAt,
      error,
      startCall,
      toggleMute,
      hangUp,
      dismiss,
    }),
    [status, muted, peerName, connectedAt, error, startCall, toggleMute, hangUp, dismiss],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      {status !== 'idle' && <ActiveCallScreen />}
    </CallContext.Provider>
  );
}

export function useCall(): CallState {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used within CallProvider');
  return ctx;
}
