import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useQueryClient } from '@tanstack/react-query';
import { Voice, Call, CallInvite } from '@twilio/voice-react-native-sdk';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CALLER_ID_KEY } from '@/lib/config';
import { useCallerIds, prettyPhone, type CallerId } from './hooks';
import { ActiveCallScreen } from './ActiveCallScreen';
import {
  CallContext,
  useCall,
  type CallLead,
  type CallOutcomeInput,
  type CallState,
  type CallStatus,
} from './callState';

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

  // The outgoing call in flight and the lead it is for, resolved before the
  // dial so nothing about it can change underneath the call.
  const qc = useQueryClient();
  const currentRef = useRef<{ leadId: string; surplus: boolean; name: string } | null>(null);
  const startingRef = useRef(false);
  // A finished surplus call still owed an outcome. Kept apart from the live
  // call state so a callback ringing in mid-form cannot wipe it: only saving
  // or closing the form clears it. The API keys the CallLog on our leg's
  // CallSid, so that is what the outcome is saved against.
  const [pending, setPending] = useState<{ sid: string; leadId: string; name: string } | null>(null);

  const { token: authToken } = useAuth();
  const { data: callerIds = [] } = useCallerIds(!!authToken);
  const [callerNumber, setCallerNumber] = useState<string | null>(null);

  // Restore the last chosen outbound number.
  useEffect(() => {
    SecureStore.getItemAsync(CALLER_ID_KEY)
      .then((v) => setCallerNumber(v || null))
      .catch(() => {});
  }, []);

  // A stored number that is no longer on the org's list would silently fall
  // back server-side; drop it so the UI shows what will actually be used.
  const callerId = callerIds.find((c) => c.number === callerNumber) ?? null;

  const setCallerId = useCallback((c: CallerId | null) => {
    setCallerNumber(c?.number ?? null);
    if (c) SecureStore.setItemAsync(CALLER_ID_KEY, c.number).catch(() => {});
    else SecureStore.deleteItemAsync(CALLER_ID_KEY).catch(() => {});
  }, []);

  const attach = useCallback((call: Call, outgoing: boolean) => {
    callRef.current = call;
    // The sid is only known once Twilio has the call, so read it as soon as
    // any later event fires rather than at connect().
    let sid: string | undefined;
    const readSid = () => {
      sid = call.getSid() || sid;
    };
    call.on(Call.Event.Ringing, () => {
      readSid();
      setStatus('ringing');
    });
    call.on(Call.Event.Connected, () => {
      readSid();
      setStatus('connected');
      setConnectedAt(Date.now());
    });
    call.on(Call.Event.Reconnecting, () => setStatus('reconnecting'));
    call.on(Call.Event.Disconnected, () => {
      readSid();
      const cur = outgoing ? currentRef.current : null;
      if (cur?.surplus && sid) setPending({ sid, leadId: cur.leadId, name: cur.name });
      if (outgoing) currentRef.current = null;
      setStatus('ended');
      callRef.current = null;
    });
    call.on(Call.Event.ConnectFailure, (e: any) => {
      // Never reached the carrier, so there is no call to say anything about.
      if (outgoing) currentRef.current = null;
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
        attach(call, false);
        setStatus('connected');
        setConnectedAt(Date.now());
      });
      invite.on(CallInvite.Event.Cancelled, () => {
        // Leave an ended screen alone: it may be an outcome form mid-entry.
        if (!callRef.current) setStatus((st) => (st === 'ended' ? st : 'idle'));
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
    async (toNumber: string, name?: string, lead?: CallLead) => {
      if (status !== 'idle' && status !== 'ended') return; // a call is already up
      if (startingRef.current) return; // a second tap while the first resolves
      startingRef.current = true;
      setError(null);
      setMuted(false);
      setConnectedAt(null);
      setPeerName(name || toNumber);
      setStatus('connecting');
      currentRef.current = null;

      const refuse = (msg: string) => {
        setError(msg);
        setStatus('ended');
        startingRef.current = false;
      };

      // Every path that dials a lead (the claim, the conversation, the dialer
      // search, Recents) comes through here, so the do-not-contact checks live
      // here once. Both lookups are normally already cached by the screen.
      if (lead?.id) {
        const ten = (n?: string | null) => (n || '').replace(/\D/g, '').slice(-10);
        let surplus = lead.source === 'SURPLUS';
        try {
          const l: any = await qc.fetchQuery({
            queryKey: ['lead', lead.id, 'detail'],
            queryFn: async () => (await api.get(`/leads/${lead.id}`)).data,
            staleTime: 30_000,
          });
          surplus = l?.source === 'SURPLUS';
          // The server refuses a flagged NUMBER but not a claim marked
          // do-not-call, which is what "Asked not to be called" sets.
          if (surplus && l?.doNotContact) {
            return refuse(`${name || 'This claimant'} is marked do-not-call, so Dealcore will not dial them.`);
          }
        } catch {
          // Unknown source: dial anyway, the server still checks the number.
        }
        try {
          const ph: any = await qc.fetchQuery({
            queryKey: ['lead', lead.id, 'phones'],
            queryFn: async () => (await api.get(`/leads/${lead.id}/messages/to-options`)).data,
            staleTime: 60_000,
          });
          const hit = (ph?.numbers || []).find((n: any) => ten(n.number) === ten(toNumber));
          if (hit?.dnc) {
            return refuse(`${prettyPhone(toNumber)} is on the ${hit.dnc} do-not-call list, so Dealcore will not dial it.`);
          }
        } catch {
          // The voice webhook checks the number again before dialling.
        }
        currentRef.current = { leadId: lead.id, surplus, name: name || toNumber };
      }

      try {
        const { data } = await api.post('/calls/twilio/token');
        if (!data?.configured || !data?.token) {
          throw new Error('Calling is not configured on the server.');
        }
        const call = await voiceRef.current!.connect(data.token, {
          // callerId reaches the TwiML voice webhook, which re-checks it
          // against the org's numbers before dialling. Omitted = API default.
          // leadId lets the voice webhook refuse a DNC number, log the call
          // on the lead's timeline and key the CallLog to it.
          params: {
            To: toNumber,
            ...(callerId ? { callerId: callerId.number } : {}),
            ...(lead?.id ? { leadId: lead.id } : {}),
          },
        });
        attach(call, true);
      } catch (e: any) {
        currentRef.current = null;
        setError(e?.response?.data?.error || e?.message || 'Could not start the call.');
        setStatus('ended');
      } finally {
        startingRef.current = false;
      }
    },
    [status, attach, callerId, qc],
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
    setPending(null);
  }, []);

  const needsOutcome = status === 'ended' && !!pending;
  const outcomeName = pending?.name ?? null;

  const saveOutcome = useCallback(
    async (input: CallOutcomeInput) => {
      if (!pending) return;
      await api.post('/calls/twilio/disposition', { callSid: pending.sid, ...input });
      // The outcome can move the stage, stamp Tapped, set DNC and add a task.
      qc.invalidateQueries({ queryKey: ['surplus'] });
      qc.invalidateQueries({ queryKey: ['lead', pending.leadId] });
      qc.invalidateQueries({ queryKey: ['calls', 'recents'] });
    },
    [pending, qc],
  );

  const value = useMemo<CallState>(
    () => ({
      status,
      muted,
      peerName,
      connectedAt,
      error,
      callerIds,
      callerId,
      setCallerId,
      startCall,
      toggleMute,
      hangUp,
      dismiss,
      needsOutcome,
      outcomeName,
      saveOutcome,
    }),
    [
      status,
      muted,
      peerName,
      connectedAt,
      error,
      callerIds,
      callerId,
      setCallerId,
      startCall,
      toggleMute,
      hangUp,
      dismiss,
      needsOutcome,
      outcomeName,
      saveOutcome,
    ],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      {status !== 'idle' && <ActiveCallScreen />}
    </CallContext.Provider>
  );
}
