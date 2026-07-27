'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { Device, Call } from '@twilio/voice-sdk';
import { callsAPI } from '@/lib/api';

export type DialerView = 'dialpad' | 'connecting' | 'oncall' | 'summary' | 'incoming';

/** Which panel the dialpad view is showing. */
export type DialerTab = 'recents' | 'contacts' | 'keypad' | 'voicemail' | 'queue';

export interface CallContact {
  name?: string;
  phone: string;
  leadId?: string;
}

export interface CallerId {
  number: string;
  label: string;
}

/** Where a warm transfer has got to. 'idle' means no transfer in progress. */
export type TransferState = 'idle' | 'consulting';

interface DialerState {
  open: boolean;
  view: DialerView;
  tab: DialerTab;
  /** Whether Twilio Voice is configured + the Device is usable. */
  ready: boolean;
  error: string | null;
  contact: CallContact | null;
  muted: boolean;
  onHold: boolean;
  durationSec: number;
  lastCallSid: string | null;
  /** An inbound call is ringing and awaiting accept/decline. */
  incoming: boolean;

  /** Outbound caller IDs available, and the one currently selected. */
  callerIds: CallerId[];
  callerId: CallerId | null;
  setCallerId: (c: CallerId) => void;

  transferState: TransferState;
  /** Number being consulted during a warm transfer. */
  transferTo: string | null;

  openDialer: () => void;
  closeDialer: () => void;
  toggleDialer: () => void;
  setTab: (t: DialerTab) => void;
  startCall: (contact: CallContact) => Promise<void>;
  hangup: () => void;
  toggleMute: () => void;
  toggleHold: () => Promise<void>;
  sendDigit: (digit: string) => void;
  acceptIncoming: () => void;
  declineIncoming: () => void;
  blindTransfer: (to: string) => Promise<void>;
  startWarmTransfer: (to: string) => Promise<void>;
  completeWarmTransfer: () => Promise<void>;
  cancelWarmTransfer: () => Promise<void>;
  saveDisposition: (disposition: string, notes?: string) => Promise<void>;
  reset: () => void;
}

const DialerContext = createContext<DialerState | null>(null);

export function useDialer() {
  const ctx = useContext(DialerContext);
  if (!ctx) throw new Error('useDialer must be used within <DialerProvider>');
  return ctx;
}

export function DialerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<DialerView>('dialpad');
  const [tab, setTab] = useState<DialerTab>('keypad');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contact, setContact] = useState<CallContact | null>(null);
  const [muted, setMuted] = useState(false);
  const [onHold, setOnHold] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [lastCallSid, setLastCallSid] = useState<string | null>(null);
  const [incoming, setIncoming] = useState(false);
  const [callerIds, setCallerIds] = useState<CallerId[]>([]);
  const [callerId, setCallerId] = useState<CallerId | null>(null);
  const [transferState, setTransferState] = useState<TransferState>('idle');
  const [transferTo, setTransferTo] = useState<string | null>(null);

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initPromiseRef = useRef<Promise<Device | null> | null>(null);
  const incomingHandlerRef = useRef<(call: Call) => void>(() => {});

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Lazily create + register the Twilio Device. Re-used across calls.
  const getDevice = useCallback(async (): Promise<Device | null> => {
    if (deviceRef.current) return deviceRef.current;
    if (initPromiseRef.current) return initPromiseRef.current;

    initPromiseRef.current = (async () => {
      try {
        const res = await callsAPI.twilioToken();
        if (!res.data?.configured || !res.data?.token) {
          setReady(false);
          setError('Calling is not configured yet.');
          return null;
        }

        const device = new Device(res.data.token, {
          codecPreferences: ['opus', 'pcmu'] as any,
          logLevel: 'error' as any,
        });

        device.on('tokenWillExpire', async () => {
          try {
            const r = await callsAPI.twilioToken();
            if (r.data?.token) device.updateToken(r.data.token);
          } catch {
            /* will surface on next call attempt */
          }
        });

        device.on('error', async (e: any) => {
          // 20101/20104: access token invalid/expired (e.g. laptop slept past the
          // 1h TTL so tokenWillExpire never fired). Refresh and re-register.
          if (e?.code === 20101 || e?.code === 20104) {
            try {
              const r = await callsAPI.twilioToken();
              if (r.data?.token) {
                device.updateToken(r.data.token);
                if (device.state !== 'registered') await device.register();
                setError(null);
                return;
              }
            } catch {
              /* fall through to the visible error */
            }
          }
          setError(e?.message || 'Device error');
        });

        // Inbound calls ring here once the Device is registered
        device.on('incoming', (call: Call) => incomingHandlerRef.current(call));

        await device.register();
        deviceRef.current = device;
        setReady(true);
        setError(null);
        return device;
      } catch (e: any) {
        setReady(false);
        setError(e?.response?.data?.error || e?.message || 'Failed to initialize calling');
        return null;
      } finally {
        initPromiseRef.current = null;
      }
    })();

    return initPromiseRef.current;
  }, []);

  const wireCall = useCallback(
    (call: Call) => {
      callRef.current = call;

      call.on('accept', (c: Call) => {
        setView('oncall');
        setLastCallSid((c.parameters as any)?.CallSid || null);
        setDurationSec(0);
        stopTimer();
        timerRef.current = setInterval(() => setDurationSec((s) => s + 1), 1000);
      });

      const finish = () => {
        stopTimer();
        callRef.current = null;
        setMuted(false);
        setOnHold(false);
        setTransferState('idle');
        setTransferTo(null);
        setView('summary');
      };

      call.on('disconnect', finish);
      call.on('cancel', finish);
      call.on('reject', finish);
      call.on('error', (e: any) => {
        setError(e?.message || 'Call error');
        finish();
      });
    },
    [stopTimer],
  );

  // Inbound: a call is ringing this browser. Show accept/decline, wait for the
  // user before answering audio.
  const handleIncoming = useCallback(
    (call: Call) => {
      const cp: Map<string, string> | undefined = (call as any).customParameters;
      const from = cp?.get('From') || (call.parameters as any)?.From || '';
      const name = cp?.get('callerName') || '';
      const leadId = cp?.get('leadId') || undefined;

      callRef.current = call;
      setContact({ name: name || undefined, phone: from, leadId });
      setIncoming(true);
      setOpen(true);
      setView('incoming');
      setError(null);

      call.on('accept', (c: Call) => {
        setIncoming(false);
        setView('oncall');
        setLastCallSid((c.parameters as any)?.CallSid || null);
        setDurationSec(0);
        stopTimer();
        timerRef.current = setInterval(() => setDurationSec((s) => s + 1), 1000);
      });

      const endRinging = () => {
        stopTimer();
        callRef.current = null;
        setIncoming(false);
        setMuted(false);
        setOnHold(false);
        setTransferState('idle');
        setTransferTo(null);
      };

      // Caller hung up or we rejected before answering -> back to idle
      call.on('cancel', () => {
        endRinging();
        setView('dialpad');
      });
      call.on('reject', () => {
        endRinging();
        setView('dialpad');
      });
      // Disconnect after answering -> disposition; before answering -> idle
      call.on('disconnect', () => {
        endRinging();
        setView((v) => (v === 'oncall' ? 'summary' : 'dialpad'));
      });
      call.on('error', (e: any) => {
        setError(e?.message || 'Call error');
        endRinging();
        setView('dialpad');
      });
    },
    [stopTimer],
  );

  useEffect(() => {
    incomingHandlerRef.current = handleIncoming;
  }, [handleIncoming]);

  // Register the Device on mount so inbound calls can reach this browser.
  useEffect(() => {
    getDevice();
  }, [getDevice]);

  // Load the outbound caller IDs for the "Calling From" picker. The server
  // re-validates whatever we send, so this list is a convenience, not a control.
  useEffect(() => {
    let cancelled = false;
    callsAPI
      .twilioNumbers()
      .then((res) => {
        if (cancelled) return;
        const nums: CallerId[] = res.data?.numbers || [];
        setCallerIds(nums);
        setCallerId((current) => current ?? nums[0] ?? null);
      })
      .catch(() => {
        /* picker just stays empty; the server falls back to the default number */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const acceptIncoming = useCallback(() => {
    callRef.current?.accept();
  }, []);

  const declineIncoming = useCallback(() => {
    callRef.current?.reject();
  }, []);

  const startCall = useCallback(
    async (c: CallContact) => {
      setError(null);
      setContact(c);
      setOpen(true);
      setView('connecting');

      const device = await getDevice();
      if (!device) {
        setView('dialpad');
        return;
      }

      try {
        const call = await device.connect({
          params: {
            To: c.phone,
            ...(c.leadId ? { leadId: c.leadId } : {}),
            ...(callerId ? { callerId: callerId.number } : {}),
          },
        });
        wireCall(call);
      } catch (e: any) {
        setError(e?.message || 'Could not place the call');
        setView('dialpad');
      }
    },
    [getDevice, wireCall, callerId],
  );

  const hangup = useCallback(() => {
    callRef.current?.disconnect();
  }, []);

  const toggleMute = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    const next = !call.isMuted();
    call.mute(next);
    setMuted(next);
  }, []);

  const sendDigit = useCallback((digit: string) => {
    callRef.current?.sendDigits(digit);
  }, []);

  // ── In-call controls ──────────────────────────────────────────────────────
  // These act on the server-side conference rather than the local WebRTC leg,
  // so they need the CallSid. Twilio can legitimately fail here (the other
  // party hung up mid-action), so failures surface as a dialer error, not a throw.
  const callControl = useCallback(
    async (fn: (sid: string) => Promise<{ data: any }>, failure: string) => {
      if (!lastCallSid) {
        setError('Call is not connected yet');
        return null;
      }
      try {
        const res = await fn(lastCallSid);
        if (res.data?.ok === false) {
          setError(res.data.error || failure);
          return null;
        }
        setError(null);
        return res.data;
      } catch (e: any) {
        setError(e?.response?.data?.error || e?.message || failure);
        return null;
      }
    },
    [lastCallSid],
  );

  const toggleHold = useCallback(async () => {
    const next = !onHold;
    const ok = await callControl(
      (sid) => callsAPI.twilioHold(sid, next),
      'Could not change hold',
    );
    if (ok) setOnHold(next);
  }, [callControl, onHold]);

  const blindTransfer = useCallback(
    async (to: string) => {
      const ok = await callControl(
        (sid) => callsAPI.twilioBlindTransfer(sid, to),
        'Transfer failed',
      );
      // On a blind transfer we leave the call immediately; the seller stays
      // connected to the target without us.
      if (ok) {
        stopTimer();
        callRef.current = null;
        setView('summary');
      }
    },
    [callControl, stopTimer],
  );

  const startWarmTransfer = useCallback(
    async (to: string) => {
      const ok = await callControl(
        (sid) => callsAPI.twilioWarmTransfer(sid, to),
        'Could not start transfer',
      );
      if (ok) {
        setTransferState('consulting');
        setTransferTo(to);
        // The seller is on hold for the duration of the consult.
        setOnHold(true);
      }
    },
    [callControl],
  );

  const completeWarmTransfer = useCallback(async () => {
    const ok = await callControl(
      (sid) => callsAPI.twilioWarmTransferComplete(sid),
      'Could not complete transfer',
    );
    if (ok) {
      setTransferState('idle');
      setTransferTo(null);
      setOnHold(false);
      stopTimer();
      callRef.current = null;
      setView('summary');
    }
  }, [callControl, stopTimer]);

  const cancelWarmTransfer = useCallback(async () => {
    const ok = await callControl(
      (sid) => callsAPI.twilioWarmTransferCancel(sid),
      'Could not cancel transfer',
    );
    if (ok) {
      setTransferState('idle');
      setTransferTo(null);
      setOnHold(false);
    }
  }, [callControl]);

  const saveDisposition = useCallback(
    async (disposition: string, notes?: string) => {
      if (lastCallSid) {
        try {
          await callsAPI.twilioDisposition(lastCallSid, disposition, notes);
        } catch {
          /* non-blocking */
        }
      }
      setView('dialpad');
      setContact(null);
      setDurationSec(0);
      setLastCallSid(null);
    },
    [lastCallSid],
  );

  const reset = useCallback(() => {
    setView('dialpad');
    setContact(null);
    setDurationSec(0);
    setLastCallSid(null);
    setError(null);
    setOnHold(false);
    setTransferState('idle');
    setTransferTo(null);
  }, []);

  const openDialer = useCallback(() => setOpen(true), []);
  const closeDialer = useCallback(() => setOpen(false), []);
  const toggleDialer = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    return () => {
      stopTimer();
      callRef.current?.disconnect();
      deviceRef.current?.destroy();
    };
  }, [stopTimer]);

  return (
    <DialerContext.Provider
      value={{
        open,
        view,
        tab,
        ready,
        error,
        contact,
        muted,
        onHold,
        durationSec,
        lastCallSid,
        incoming,
        callerIds,
        callerId,
        setCallerId,
        transferState,
        transferTo,
        openDialer,
        closeDialer,
        toggleDialer,
        setTab,
        startCall,
        hangup,
        toggleMute,
        toggleHold,
        sendDigit,
        acceptIncoming,
        declineIncoming,
        blindTransfer,
        startWarmTransfer,
        completeWarmTransfer,
        cancelWarmTransfer,
        saveDisposition,
        reset,
      }}
    >
      {children}
    </DialerContext.Provider>
  );
}
