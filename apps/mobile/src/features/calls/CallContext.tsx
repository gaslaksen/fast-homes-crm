import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Voice, Call, CallInvite } from '@twilio/voice-react-native-sdk';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ActiveCallScreen } from './ActiveCallScreen';
import { CallContext, useCall, type CallState, type CallStatus } from './callState';

// Re-exported so existing imports from '@/features/calls/CallContext' keep working.
export { useCall };
export type { CallState, CallStatus };

export function CallProvider({ children }: { children: React.ReactNode }) {
  const voiceRef = useRef<Voice | null>(null);
  const callRef = useRef<Call | null>(null);

  const [status, setStatus] = useState<CallStatus>('idle');
  const [muted, setMuted] = useState(false);
  const [peerName, setPeerName] = useState('');
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { token: authToken } = useAuth();

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

  // Create the Voice instance once; wire PushKit + incoming-call handling.
  useEffect(() => {
    const voice = new Voice();
    voiceRef.current = voice;

    const onInvite = (invite: CallInvite) => {
      // CallKit shows the native incoming-call UI. We only raise our in-app
      // screen once the call is accepted, so we don't compete with CallKit.
      let name = 'Incoming call';
      try {
        const params = invite.getCustomParameters?.() as Record<string, string>;
        name = params?.callerName || invite.getFrom?.() || name;
      } catch {
        // fall back to the default label
      }
      invite.on(CallInvite.Event.Accepted, (call: Call) => {
        setError(null);
        setMuted(false);
        setPeerName(name);
        attach(call);
        setStatus('connected');
        setConnectedAt(Date.now());
      });
      invite.on(CallInvite.Event.Cancelled, () => {
        if (!callRef.current) setStatus('idle');
      });
    };

    voice.on(Voice.Event.CallInvite, onInvite);

    // iOS: set up the PushKit registry so VoIP pushes can wake the app.
    if (Platform.OS === 'ios') {
      voice.initializePushRegistry().catch((e: any) =>
        console.warn('[call] initializePushRegistry failed:', e?.message || e),
      );
    }

    return () => {
      callRef.current?.disconnect().catch(() => {});
    };
  }, []);

  // Register/unregister for incoming calls as the auth session changes.
  useEffect(() => {
    const voice = voiceRef.current;
    if (!authToken || !voice) return;
    let registeredToken: string | null = null;
    (async () => {
      try {
        const { data } = await api.post('/calls/twilio/token', null, {
          params: { platform: 'ios' },
        });
        if (data?.configured && data?.token) {
          await voice.register(data.token);
          registeredToken = data.token;
          console.log('[call] registered for incoming calls');
        }
      } catch (e: any) {
        console.warn('[call] incoming registration failed:', e?.message || e);
      }
    })();
    return () => {
      if (registeredToken) voice.unregister(registeredToken).catch(() => {});
    };
  }, [authToken]);

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
