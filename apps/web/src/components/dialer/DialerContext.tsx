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

export interface CallContact {
  name?: string;
  phone: string;
  leadId?: string;
}

interface DialerState {
  open: boolean;
  view: DialerView;
  /** Whether Twilio Voice is configured + the Device is usable. */
  ready: boolean;
  error: string | null;
  contact: CallContact | null;
  muted: boolean;
  durationSec: number;
  lastCallSid: string | null;
  /** An inbound call is ringing and awaiting accept/decline. */
  incoming: boolean;

  openDialer: () => void;
  closeDialer: () => void;
  toggleDialer: () => void;
  startCall: (contact: CallContact) => Promise<void>;
  hangup: () => void;
  toggleMute: () => void;
  sendDigit: (digit: string) => void;
  acceptIncoming: () => void;
  declineIncoming: () => void;
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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contact, setContact] = useState<CallContact | null>(null);
  const [muted, setMuted] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [lastCallSid, setLastCallSid] = useState<string | null>(null);
  const [incoming, setIncoming] = useState(false);

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

        device.on('error', (e: any) => {
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
          },
        });
        wireCall(call);
      } catch (e: any) {
        setError(e?.message || 'Could not place the call');
        setView('dialpad');
      }
    },
    [getDevice, wireCall],
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
        ready,
        error,
        contact,
        muted,
        durationSec,
        lastCallSid,
        incoming,
        openDialer,
        closeDialer,
        toggleDialer,
        startCall,
        hangup,
        toggleMute,
        sendDigit,
        acceptIncoming,
        declineIncoming,
        saveDisposition,
        reset,
      }}
    >
      {children}
    </DialerContext.Provider>
  );
}
